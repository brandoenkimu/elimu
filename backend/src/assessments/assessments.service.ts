import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { letterFor, round2, type AuthUser } from '../common/types';
import { DatabaseService } from '../database/database.service';
import { FilesService } from '../files/files.service';
import { AccessService } from '../shared/access.service';
import { AuditService } from '../shared/audit.service';
import { NotificationsService } from '../shared/notifications.service';
import type { AssessmentDto, AssessmentPatchDto, GradeDto, QuestionDto, SubmissionInput } from './assessments.dto';

interface AssessmentRow {
  id: string; offering_id: string; kind: 'assignment' | 'exam'; title: string; instructions: string;
  status: 'draft' | 'published' | 'closed'; opens_at: Date | null; due_at: Date | null; duration_min: number | null;
  max_score: number; weight: number; allow_file: boolean; allow_text: boolean; brief_file_id: string | null;
  auto_mark: boolean; results_released: boolean; show_answers: boolean; created_at: Date;
}
interface QuestionRow {
  id: string; position: number; kind: 'mcq' | 'text'; prompt: string; points: number;
  options: string[] | null; correct_key: string | null; model_answer: string;
}
interface SubmissionRow {
  id: string; assessment_id: string; student_id: string; status: 'in_progress' | 'submitted' | 'graded';
  started_at: Date; submitted_at: Date | null; text_answer: string; is_late: boolean;
  score: number | null; mcq_score: number | null; feedback: string; graded_at: Date | null;
}

type Run = (sql: string, params: unknown[]) => Promise<unknown>;

const GRACE_MS = 60_000;
const iso = (d: Date | null) => (d ? d.toISOString() : null);

@Injectable()
export class AssessmentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------------------------------------------------------------- loading helpers

  async load(id: string): Promise<AssessmentRow> {
    const { rows } = await this.db.query<AssessmentRow>('SELECT * FROM assessments WHERE id = $1', [id]);
    if (!rows[0]) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Assessment not found.' });
    return rows[0];
  }

  private async questionsOf(assessmentId: string): Promise<QuestionRow[]> {
    const { rows } = await this.db.query<QuestionRow>('SELECT id, position, kind, prompt, points, options, correct_key, model_answer FROM questions WHERE assessment_id = $1 ORDER BY position', [assessmentId]);
    return rows;
  }

  private isTeacher(user: AuthUser, offeringLecturerId: string | null): boolean {
    return user.role === 'admin' || (user.role === 'lecturer' && offeringLecturerId === user.id);
  }

  /** Returns the assessment and whether the caller teaches the class. Students must be enrolled and the item published. */
  private async open(user: AuthUser, id: string) {
    const a = await this.load(id);
    const offering = await this.access.assertView(user, a.offering_id);
    const teacher = this.isTeacher(user, offering.lecturer_id);
    if (!teacher && a.status === 'draft') throw new NotFoundException({ code: 'NOT_FOUND', message: 'Assessment not found.' });
    return { a, teacher };
  }

  private deadlineFor(a: AssessmentRow, s: Pick<SubmissionRow, 'started_at'>): Date | null {
    const byDuration = a.kind === 'exam' && a.duration_min ? new Date(s.started_at.getTime() + a.duration_min * 60_000) : null;
    if (byDuration && a.due_at) return byDuration < a.due_at ? byDuration : a.due_at;
    return byDuration ?? a.due_at;
  }

  // ---------------------------------------------------------------- lecturer: create and edit

  async list(user: AuthUser, offeringId: string) {
    const offering = await this.access.assertView(user, offeringId);
    const teacher = this.isTeacher(user, offering.lecturer_id);
    if (teacher) {
      await this.finalizeExpired(offeringId);
      const { rows } = await this.db.query(
        `SELECT a.id, a.kind, a.title, a.status, a.opens_at AS "opensAt", a.due_at AS "dueAt", a.duration_min AS "durationMin",
                a.max_score AS "maxScore", a.weight, a.auto_mark AS "autoMark", a.results_released AS "resultsReleased",
                (SELECT count(*) FROM questions q WHERE q.assessment_id = a.id) AS "questionCount",
                (SELECT count(*) FROM submissions s WHERE s.assessment_id = a.id AND s.status <> 'in_progress') AS submitted,
                (SELECT count(*) FROM submissions s WHERE s.assessment_id = a.id AND s.status = 'graded') AS graded
           FROM assessments a WHERE a.offering_id = $1 ORDER BY a.created_at DESC`,
        [offeringId],
      );
      return rows;
    }
    const { rows } = await this.db.query<AssessmentRow & { sub_status: string | null; sub_score: number | null; sub_late: boolean | null; qcount: number }>(
      `SELECT a.*, s.status AS sub_status, s.score AS sub_score, s.is_late AS sub_late,
              (SELECT count(*) FROM questions q WHERE q.assessment_id = a.id) AS qcount
         FROM assessments a LEFT JOIN submissions s ON s.assessment_id = a.id AND s.student_id = $2
        WHERE a.offering_id = $1 AND a.status <> 'draft' ORDER BY a.created_at DESC`,
      [offeringId, user.id],
    );
    return rows.map((r) => ({
      id: r.id, kind: r.kind, title: r.title, status: r.status, opensAt: iso(r.opens_at), dueAt: iso(r.due_at),
      durationMin: r.duration_min, maxScore: r.max_score, weight: r.weight, questionCount: r.qcount,
      mine: r.sub_status ? { status: r.sub_status, isLate: r.sub_late, score: r.results_released && r.sub_status === 'graded' ? r.sub_score : null } : null,
      resultsReleased: r.results_released,
    }));
  }

  async create(user: AuthUser, offeringId: string, dto: AssessmentDto) {
    await this.access.assertTeach(user, offeringId);
    if (dto.briefFileId) await this.files.attach(user.id, [dto.briefFileId]);
    const id = await this.db.transaction(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO assessments (offering_id, created_by, kind, title, instructions, opens_at, due_at, duration_min, max_score,
                                  weight, allow_file, allow_text, brief_file_id, auto_mark, show_answers)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
        [offeringId, user.id, dto.kind, dto.title, dto.instructions, dto.opensAt, dto.dueAt, dto.durationMin, dto.maxScore,
         dto.weight, dto.allowFile, dto.allowText, dto.briefFileId, dto.autoMark, dto.showAnswers],
      );
      await this.writeQuestions(client, rows[0].id, dto.questions);
      return rows[0].id;
    });
    return { id };
  }

  private async writeQuestions(client: PoolClient, assessmentId: string, questions: QuestionDto[]) {
    await client.query('DELETE FROM questions WHERE assessment_id = $1', [assessmentId]);
    let position = 1;
    for (const q of questions) {
      await client.query(
        `INSERT INTO questions (assessment_id, position, kind, prompt, points, options, correct_key, model_answer)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
        [assessmentId, position++, q.kind, q.prompt, q.points, q.kind === 'mcq' ? JSON.stringify(q.options) : null, q.kind === 'mcq' ? q.correctKey : null, q.modelAnswer],
      );
    }
  }

  async update(user: AuthUser, id: string, patch: AssessmentPatchDto) {
    const a = await this.load(id);
    await this.access.assertTeach(user, a.offering_id);
    const hasSubmissions = !!(await this.db.query('SELECT 1 FROM submissions WHERE assessment_id = $1 LIMIT 1', [id])).rowCount;
    if (patch.questions && hasSubmissions) {
      throw new ConflictException({ code: 'HAS_SUBMISSIONS', message: 'Students have already started this one, so its questions can no longer change.' });
    }
    if (patch.briefFileId) await this.files.attach(user.id, [patch.briefFileId]);

    const map: Record<string, string> = {
      kind: 'kind', title: 'title', instructions: 'instructions', opensAt: 'opens_at', dueAt: 'due_at', durationMin: 'duration_min',
      maxScore: 'max_score', weight: 'weight', allowFile: 'allow_file', allowText: 'allow_text', briefFileId: 'brief_file_id',
      autoMark: 'auto_mark', showAnswers: 'show_answers',
    };
    const sets: string[] = ['updated_at = now()'];
    const values: unknown[] = [];
    for (const [key, column] of Object.entries(map)) {
      const v = (patch as Record<string, unknown>)[key];
      if (v !== undefined) { values.push(v); sets.push(`${column} = $${values.length + 1}`); }
    }
    await this.db.transaction(async (client) => {
      await client.query(`UPDATE assessments SET ${sets.join(', ')} WHERE id = $1`, [id, ...values]);
      if (patch.questions) await this.writeQuestions(client, id, patch.questions);
    });
  }

  async setStatus(user: AuthUser, id: string, status: 'published' | 'closed' | 'draft') {
    const a = await this.load(id);
    await this.access.assertTeach(user, a.offering_id);
    if (status === 'draft' && (await this.db.query('SELECT 1 FROM submissions WHERE assessment_id = $1 LIMIT 1', [id])).rowCount) {
      throw new ConflictException({ code: 'HAS_SUBMISSIONS', message: 'It already has submissions, so it cannot go back to draft. Close it instead.' });
    }
    if (status === 'published') {
      const q = await this.db.query<{ n: number }>('SELECT count(*) AS n FROM questions WHERE assessment_id = $1', [id]);
      if (q.rows[0].n === 0 && !a.allow_file && !a.allow_text) {
        throw new BadRequestException({ code: 'EMPTY', message: 'Add questions, or allow students to type or upload an answer.' });
      }
    }
    await this.db.query('UPDATE assessments SET status = $2, updated_at = now() WHERE id = $1', [id, status]);
    if (status === 'published' && a.status === 'draft') {
      const info = await this.db.query<{ code: string }>(`SELECT un.code FROM offerings o JOIN units un ON un.id = o.unit_id WHERE o.id = $1`, [a.offering_id]);
      void this.notifications.notifyEnrolled(a.offering_id, {
        type: 'assessment',
        title: `${info.rows[0]?.code ?? 'Class'}: new ${a.kind} "${a.title}"`,
        body: a.due_at ? `Due ${a.due_at.toISOString().slice(0, 16).replace('T', ' ')} UTC` : '',
        data: { link: `/app/classes/${a.offering_id}/work/${id}` },
      });
    }
    await this.audit.record(user, `assessment.${status}`, { type: 'assessment', id });
  }

  async remove(user: AuthUser, id: string) {
    const a = await this.load(id);
    await this.access.assertTeach(user, a.offering_id);
    if ((await this.db.query(`SELECT 1 FROM submissions WHERE assessment_id = $1 AND status <> 'in_progress' LIMIT 1`, [id])).rowCount) {
      throw new ConflictException({ code: 'HAS_SUBMISSIONS', message: 'Students have submitted work. Close it instead of deleting.' });
    }
    await this.db.query('DELETE FROM assessments WHERE id = $1', [id]);
  }

  // ---------------------------------------------------------------- viewing

  async view(user: AuthUser, id: string) {
    const { a, teacher } = await this.open(user, id);
    const questions = await this.questionsOf(id);
    const brief = a.brief_file_id ? (await this.files.meta([a.brief_file_id]))[0] ?? null : null;
    const head = {
      id: a.id, offeringId: a.offering_id, kind: a.kind, title: a.title, instructions: a.instructions, status: a.status,
      opensAt: iso(a.opens_at), dueAt: iso(a.due_at), durationMin: a.duration_min, maxScore: a.max_score, weight: a.weight,
      allowFile: a.allow_file, allowText: a.allow_text, brief, questionCount: questions.length,
      totalPoints: round2(questions.reduce((n, q) => n + q.points, 0)),
    };

    if (teacher) {
      return {
        ...head, teacher: true, autoMark: a.auto_mark, resultsReleased: a.results_released, showAnswers: a.show_answers,
        questions: questions.map((q) => ({ id: q.id, kind: q.kind, prompt: q.prompt, points: q.points, options: q.options, correctKey: q.correct_key, modelAnswer: q.model_answer })),
      };
    }

    await this.finalizeOne(id, user.id);
    const sub = await this.mySubmission(a, user.id);
    const revealAnswers = !!sub && sub.status !== 'in_progress' && a.results_released && a.show_answers;
    return {
      ...head, teacher: false, resultsReleased: a.results_released,
      // Questions appear only once the student has started, so an exam cannot be read in advance.
      questions: sub
        ? questions.map((q) => ({
            id: q.id, kind: q.kind, prompt: q.prompt, points: q.points, options: q.options,
            ...(revealAnswers ? { correctKey: q.correct_key, modelAnswer: q.model_answer } : {}),
          }))
        : [],
      submission: sub,
    };
  }

  private async mySubmission(a: AssessmentRow, studentId: string) {
    const { rows } = await this.db.query<SubmissionRow>('SELECT * FROM submissions WHERE assessment_id = $1 AND student_id = $2', [a.id, studentId]);
    const s = rows[0];
    if (!s) return null;
    const [answers, fileRows] = await Promise.all([
      this.db.query<{ question_id: string; choice_key: string | null; text_answer: string; score: number | null; feedback: string }>(
        'SELECT question_id, choice_key, text_answer, score, feedback FROM answers WHERE submission_id = $1', [s.id]),
      this.db.query<{ file_id: string }>('SELECT file_id FROM submission_files WHERE submission_id = $1', [s.id]),
    ]);
    const released = a.results_released && s.status === 'graded';
    const percent = released && s.score !== null ? round2((s.score / a.max_score) * 100) : null;
    return {
      id: s.id, status: s.status, startedAt: iso(s.started_at), submittedAt: iso(s.submitted_at), isLate: s.is_late,
      deadline: iso(this.deadlineFor(a, s)), textAnswer: s.text_answer,
      answers: Object.fromEntries(answers.rows.map((r) => [r.question_id, { choiceKey: r.choice_key, textAnswer: r.text_answer, ...(released ? { score: r.score, feedback: r.feedback } : {}) }])),
      files: await this.files.meta(fileRows.rows.map((f) => f.file_id)),
      result: released ? { score: s.score, maxScore: a.max_score, percent, letter: percent === null ? null : letterFor(percent), feedback: s.feedback } : null,
    };
  }

  // ---------------------------------------------------------------- student: start, save, submit

  async start(user: AuthUser, id: string) {
    const { a } = await this.open(user, id);
    await this.access.assertEnrolled(user, a.offering_id);
    this.assertOpen(a);
    await this.db.query(
      `INSERT INTO submissions (assessment_id, student_id) VALUES ($1, $2) ON CONFLICT (assessment_id, student_id) DO NOTHING`,
      [id, user.id],
    );
    return this.view(user, id);
  }

  private assertOpen(a: AssessmentRow) {
    const now = Date.now();
    if (a.status !== 'published') throw new ForbiddenException({ code: 'CLOSED', message: 'This is closed to new work.' });
    if (a.opens_at && a.opens_at.getTime() > now) throw new ForbiddenException({ code: 'NOT_OPEN', message: 'This is not open yet.' });
    if (a.kind === 'exam' && a.due_at && a.due_at.getTime() + GRACE_MS < now) throw new ForbiddenException({ code: 'CLOSED', message: 'The exam window has ended.' });
  }

  async save(user: AuthUser, id: string, input: SubmissionInput, final: boolean) {
    const { a } = await this.open(user, id);
    await this.access.assertEnrolled(user, a.offering_id);
    await this.finalizeOne(id, user.id);
    const { rows } = await this.db.query<SubmissionRow>('SELECT * FROM submissions WHERE assessment_id = $1 AND student_id = $2', [id, user.id]);
    const s = rows[0];
    if (!s) throw new ConflictException({ code: 'NOT_STARTED', message: 'Start it first.' });
    if (s.status !== 'in_progress') throw new ConflictException({ code: 'ALREADY_SUBMITTED', message: 'You have already submitted this.' });
    if (a.status !== 'published') throw new ForbiddenException({ code: 'CLOSED', message: 'This is closed to new work.' });

    const deadline = this.deadlineFor(a, s);
    const late = !!deadline && deadline.getTime() < Date.now();
    if (a.kind === 'exam' && deadline && late && deadline.getTime() + GRACE_MS < Date.now()) {
      throw new ForbiddenException({ code: 'TIME_UP', message: 'Time is up. Your saved answers were submitted for you.' });
    }

    const questions = await this.questionsOf(id);
    const byId = new Map(questions.map((q) => [q.id, q]));
    if (input.fileIds?.length) await this.files.attach(user.id, input.fileIds);
    if (input.fileIds?.length && !a.allow_file) throw new BadRequestException({ code: 'FILES_NOT_ALLOWED', message: 'File uploads are not accepted for this one.' });
    if (input.textAnswer && !a.allow_text) throw new BadRequestException({ code: 'TEXT_NOT_ALLOWED', message: 'Typed answers are not accepted for this one.' });
    for (const ans of input.answers ?? []) {
      const q = byId.get(ans.questionId);
      if (!q) throw new BadRequestException({ code: 'BAD_QUESTION', message: 'An answer does not belong to this paper.' });
      if (q.kind === 'mcq' && ans.textAnswer) throw new BadRequestException({ code: 'BAD_ANSWER', message: 'Choose one of the options.' });
      if (q.kind === 'text' && ans.choiceKey) throw new BadRequestException({ code: 'BAD_ANSWER', message: 'This question needs a typed answer.' });
    }

    await this.db.transaction(async (client) => {
      if (input.textAnswer !== undefined) await client.query('UPDATE submissions SET text_answer = $2 WHERE id = $1', [s.id, input.textAnswer]);
      for (const ans of input.answers ?? []) {
        await client.query(
          `INSERT INTO answers (submission_id, question_id, choice_key, text_answer) VALUES ($1,$2,$3,$4)
           ON CONFLICT (submission_id, question_id) DO UPDATE SET choice_key = EXCLUDED.choice_key, text_answer = EXCLUDED.text_answer`,
          [s.id, ans.questionId, ans.choiceKey ?? null, ans.textAnswer ?? ''],
        );
      }
      if (input.fileIds) {
        await client.query('DELETE FROM submission_files WHERE submission_id = $1', [s.id]);
        for (const fid of input.fileIds) await client.query('INSERT INTO submission_files (submission_id, file_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [s.id, fid]);
      }
      if (final) await this.finalise(client, a, s.id, late);
    });
    return this.view(user, id);
  }

  /** Locks a submission and marks it. Shared by manual submit and the time-up sweep. */
  private async finalise(client: PoolClient, a: AssessmentRow, submissionId: string, late: boolean) {
    await client.query(`UPDATE submissions SET status = 'submitted', submitted_at = now(), is_late = $2 WHERE id = $1 AND status = 'in_progress'`, [submissionId, late]);
    const run: Run = (sql, params) => client.query(sql, params);
    if (a.auto_mark) await this.markMcq(run, a.id, submissionId);
    await this.settleIfFullyAutomatic(run, a, submissionId);
  }

  // ---------------------------------------------------------------- marking

  /** Scores every multiple-choice answer (unanswered questions simply earn nothing). */
  async markMcq(run: Run, assessmentId: string, submissionId?: string) {
    await run(
      `UPDATE answers a SET score = CASE WHEN a.choice_key = q.correct_key THEN q.points ELSE 0 END
         FROM questions q, submissions s
        WHERE a.question_id = q.id AND q.kind = 'mcq' AND q.assessment_id = $1 AND s.id = a.submission_id
          AND s.status <> 'in_progress' AND ($2::uuid IS NULL OR a.submission_id = $2::uuid)`,
      [assessmentId, submissionId ?? null],
    );
    await run(
      `UPDATE submissions s SET mcq_score = COALESCE((SELECT sum(a.score) FROM answers a JOIN questions q ON q.id = a.question_id
                                                      WHERE a.submission_id = s.id AND q.kind = 'mcq'), 0)
        WHERE s.assessment_id = $1 AND s.status <> 'in_progress' AND ($2::uuid IS NULL OR s.id = $2::uuid)`,
      [assessmentId, submissionId ?? null],
    );
  }

  /** A paper made only of multiple-choice questions, with auto-marking on, needs no lecturer: it is graded at once. */
  private async settleIfFullyAutomatic(run: Run, a: AssessmentRow, submissionId?: string) {
    if (!a.auto_mark) return;
    await run(
      `UPDATE submissions s
          SET score = round((s.mcq_score / NULLIF(t.total, 0) * $2)::numeric, 2), status = 'graded', graded_at = now()
         FROM (SELECT sum(points) AS total, count(*) FILTER (WHERE kind = 'text') AS texts FROM questions WHERE assessment_id = $1) t
        WHERE s.assessment_id = $1 AND s.status = 'submitted' AND t.total > 0 AND t.texts = 0
          AND ($3::uuid IS NULL OR s.id = $3::uuid)`,
      [a.id, a.max_score, submissionId ?? null],
    );
  }

  /** Lecturer re-runs auto-marking for everything submitted so far. */
  async autoMark(user: AuthUser, id: string) {
    const a = await this.load(id);
    await this.access.assertTeach(user, a.offering_id);
    await this.finalizeExpired(a.offering_id);
    const run: Run = (sql, params) => this.db.query(sql, params);
    await this.markMcq(run, id);
    await this.settleIfFullyAutomatic(run, { ...a, auto_mark: true });
    const { rows } = await this.db.query<{ graded: number; waiting: number }>(
      `SELECT count(*) FILTER (WHERE status = 'graded') AS graded, count(*) FILTER (WHERE status = 'submitted') AS waiting
         FROM submissions WHERE assessment_id = $1`, [id]);
    return rows[0];
  }

  // ---------------------------------------------------------------- time-up sweep (lazy, no background worker needed)

  private async finalizeOne(assessmentId: string, studentId: string) {
    await this.finalizeWhere('s.assessment_id = $1 AND s.student_id = $2', [assessmentId, studentId]);
  }
  async finalizeExpired(offeringId: string) {
    await this.finalizeWhere('a.offering_id = $1', [offeringId]);
  }
  private async finalizeWhere(condition: string, params: unknown[]) {
    const { rows } = await this.db.query<{ sid: string; aid: string; started_at: Date }>(
      `SELECT s.id AS sid, a.id AS aid, s.started_at
         FROM submissions s JOIN assessments a ON a.id = s.assessment_id
        WHERE ${condition} AND s.status = 'in_progress' AND a.kind = 'exam'`,
      params,
    );
    for (const r of rows) {
      const a = await this.load(r.aid);
      const deadline = this.deadlineFor(a, { started_at: r.started_at });
      if (deadline && deadline.getTime() + GRACE_MS < Date.now()) {
        await this.db.transaction((client) => this.finalise(client, a, r.sid, false));
      }
    }
  }
}
