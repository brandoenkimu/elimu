import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { round2, type AuthUser } from '../common/types';
import { cleanText } from '../common/zod-helpers';
import { DatabaseService } from '../database/database.service';
import { AccessService } from '../shared/access.service';

export const EVALUATION_QUESTIONS = [
  { key: 'content', label: 'The unit content was clear and well organised' },
  { key: 'delivery', label: 'The lecturer explained ideas in a way I could follow' },
  { key: 'materials', label: 'Notes, slides and other materials were useful' },
  { key: 'assessment', label: 'Assignments and exams were fair and matched what was taught' },
  { key: 'feedback', label: 'I received feedback in good time' },
  { key: 'support', label: 'The lecturer was approachable and helped when I asked' },
  { key: 'relevance', label: 'This unit is relevant to my course and goals' },
  { key: 'overall', label: 'Overall, I am satisfied with this unit' },
] as const;

/** Lecturers only see results once this many students have answered, so no single response can be traced back. */
export const MIN_RESPONSES = 3;

const keys = EVALUATION_QUESTIONS.map((q) => q.key);
export const evaluationSchema = z
  .object({
    ratings: z.record(z.string(), z.number().int().min(1).max(5)),
    comment: cleanText(1000).default(''),
  })
  .strict()
  .superRefine((v, ctx) => {
    for (const k of keys) if (!(k in v.ratings)) ctx.addIssue({ code: 'custom', path: ['ratings', k], message: 'Please rate every statement.' });
    for (const k of Object.keys(v.ratings)) if (!keys.includes(k as (typeof keys)[number])) ctx.addIssue({ code: 'custom', path: ['ratings', k], message: 'Unknown statement.' });
  });

@Injectable()
export class EvaluationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessService,
  ) {}

  async status(user: AuthUser, offeringId: string) {
    await this.access.assertEnrolled(user, offeringId);
    const [term, done] = await Promise.all([
      this.db.query<{ evaluation_open: boolean }>(`SELECT t.evaluation_open FROM offerings o JOIN terms t ON t.id = o.term_id WHERE o.id = $1`, [offeringId]),
      this.db.query('SELECT 1 FROM evaluations WHERE offering_id = $1 AND student_id = $2', [offeringId, user.id]),
    ]);
    return { open: !!term.rows[0]?.evaluation_open, submitted: !!done.rowCount, questions: EVALUATION_QUESTIONS };
  }

  async submit(user: AuthUser, offeringId: string, dto: z.infer<typeof evaluationSchema>) {
    await this.access.assertEnrolled(user, offeringId);
    const term = await this.db.query<{ evaluation_open: boolean }>(`SELECT t.evaluation_open FROM offerings o JOIN terms t ON t.id = o.term_id WHERE o.id = $1`, [offeringId]);
    if (!term.rows[0]?.evaluation_open) throw new ForbiddenException({ code: 'EVALUATION_CLOSED', message: 'Evaluations are not open for this unit yet.' });
    const r = await this.db.query(
      `INSERT INTO evaluations (offering_id, student_id, ratings, comment) VALUES ($1,$2,$3::jsonb,$4) ON CONFLICT DO NOTHING`,
      [offeringId, user.id, JSON.stringify(dto.ratings), dto.comment],
    );
    if (!r.rowCount) throw new ConflictException({ code: 'ALREADY_DONE', message: 'You have already evaluated this unit. Thank you!' });
  }

  async results(user: AuthUser, offeringId: string) {
    await this.access.assertTeach(user, offeringId);
    const [rows, enrolled] = await Promise.all([
      this.db.query<{ ratings: Record<string, number>; comment: string }>('SELECT ratings, comment FROM evaluations WHERE offering_id = $1', [offeringId]),
      this.db.query<{ n: number }>(`SELECT count(*) AS n FROM enrolments WHERE offering_id = $1 AND status = 'enrolled'`, [offeringId]),
    ]);
    const responses = rows.rowCount ?? 0;
    const base = { responses, enrolled: enrolled.rows[0].n, minimum: MIN_RESPONSES };
    if (responses < MIN_RESPONSES) return { ...base, insufficient: true as const };

    const summary = EVALUATION_QUESTIONS.map((q) => {
      const values = rows.rows.map((r) => r.ratings[q.key]).filter((n): n is number => typeof n === 'number');
      const distribution = [1, 2, 3, 4, 5].map((n) => values.filter((v) => v === n).length);
      return { key: q.key, label: q.label, average: round2(values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1)), distribution };
    });
    // Comments are returned without order, time or author, so they cannot be matched to a person.
    const comments = rows.rows.map((r) => r.comment).filter(Boolean).sort(() => Math.random() - 0.5);
    return { ...base, insufficient: false as const, summary, comments };
  }
}
