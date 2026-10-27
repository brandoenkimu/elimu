import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { toCsv } from '../common/csv';
import { weightedTotal } from '../common/grading';
import { letterFor, round2, type AuthUser } from '../common/types';
import { DatabaseService } from '../database/database.service';
import { AccessService } from '../shared/access.service';
import { AuditService } from '../shared/audit.service';
import { NotificationsService } from '../shared/notifications.service';
import { FilesService } from '../files/files.service';
import type { GradeDto } from './assessments.dto';
import { AssessmentsService } from './assessments.service';

@Injectable()
export class GradingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessService,
    private readonly assessments: AssessmentsService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Everyone enrolled, whether or not they have started. */
  async submissions(user: AuthUser, assessmentId: string) {
    const a = await this.assessments.load(assessmentId);
    await this.access.assertTeach(user, a.offering_id);
    await this.assessments.finalizeExpired(a.offering_id);
    const { rows } = await this.db.query(
      `SELECT st.id AS "studentId", st.display_name AS "studentName", st.reg_number AS "regNumber",
              s.id AS "submissionId", COALESCE(s.status, 'not_started') AS status, s.submitted_at AS "submittedAt",
              s.is_late AS "isLate", s.score, s.mcq_score AS "mcqScore"
         FROM enrolments e JOIN users st ON st.id = e.student_id
         LEFT JOIN submissions s ON s.student_id = st.id AND s.assessment_id = $1
        WHERE e.offering_id = $2 AND e.status = 'enrolled'
        ORDER BY st.reg_number NULLS LAST, st.display_name`,
      [assessmentId, a.offering_id],
    );
    return { maxScore: a.max_score, resultsReleased: a.results_released, submissions: rows };
  }

  async submission(user: AuthUser, submissionId: string) {
    const { rows } = await this.db.query<{
      id: string; assessment_id: string; student_id: string; status: string; started_at: Date; submitted_at: Date | null; text_answer: string;
      is_late: boolean; score: number | null; mcq_score: number | null; feedback: string; student_name: string; reg_number: string | null;
    }>(
      `SELECT s.*, u.display_name AS student_name, u.reg_number FROM submissions s JOIN users u ON u.id = s.student_id WHERE s.id = $1`,
      [submissionId],
    );
    const s = rows[0];
    if (!s) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Submission not found.' });
    const a = await this.assessments.load(s.assessment_id);
    await this.access.assertTeach(user, a.offering_id);

    const [questions, answers, fileRows] = await Promise.all([
      this.db.query('SELECT id, position, kind, prompt, points, options, correct_key AS "correctKey", model_answer AS "modelAnswer" FROM questions WHERE assessment_id = $1 ORDER BY position', [a.id]),
      this.db.query<{ question_id: string; choice_key: string | null; text_answer: string; score: number | null; feedback: string }>(
        'SELECT question_id, choice_key, text_answer, score, feedback FROM answers WHERE submission_id = $1', [s.id]),
      this.db.query<{ file_id: string }>('SELECT file_id FROM submission_files WHERE submission_id = $1', [s.id]),
    ]);
    return {
      id: s.id, assessmentId: a.id, assessmentTitle: a.title, maxScore: a.max_score, student: { id: s.student_id, name: s.student_name, regNumber: s.reg_number },
      status: s.status, submittedAt: s.submitted_at, isLate: s.is_late, textAnswer: s.text_answer, score: s.score, mcqScore: s.mcq_score, feedback: s.feedback,
      questions: questions.rows,
      answers: Object.fromEntries(answers.rows.map((r) => [r.question_id, { choiceKey: r.choice_key, textAnswer: r.text_answer, score: r.score, feedback: r.feedback }])),
      files: await this.files.meta(fileRows.rows.map((f) => f.file_id)),
    };
  }

  async grade(user: AuthUser, submissionId: string, dto: GradeDto) {
    const { rows } = await this.db.query<{ assessment_id: string; status: string; student_id: string }>('SELECT assessment_id, status, student_id FROM submissions WHERE id = $1', [submissionId]);
    const s = rows[0];
    if (!s) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Submission not found.' });
    const a = await this.assessments.load(s.assessment_id);
    await this.access.assertTeach(user, a.offering_id);
    if (s.status === 'in_progress') throw new ConflictException({ code: 'NOT_SUBMITTED', message: 'The student has not submitted yet.' });

    const questions = await this.db.query<{ id: string; points: number }>('SELECT id, points FROM questions WHERE assessment_id = $1', [a.id]);
    const pointsById = new Map(questions.rows.map((q) => [q.id, q.points]));
    const totalPoints = questions.rows.reduce((n, q) => n + q.points, 0);

    for (const ans of dto.answers ?? []) {
      const max = pointsById.get(ans.questionId);
      if (max === undefined) throw new BadRequestException({ code: 'BAD_QUESTION', message: 'A mark was given for a question that is not in this paper.' });
      if (ans.score > max) throw new BadRequestException({ code: 'SCORE_TOO_HIGH', message: `A question is worth at most ${max} point(s).` });
    }
    if (dto.score !== undefined && dto.score > a.max_score) {
      throw new BadRequestException({ code: 'SCORE_TOO_HIGH', message: `The total can be at most ${a.max_score}.` });
    }

    const final = await this.db.transaction(async (client) => {
      for (const ans of dto.answers ?? []) {
        await client.query(
          `INSERT INTO answers (submission_id, question_id, score, feedback) VALUES ($1,$2,$3,$4)
           ON CONFLICT (submission_id, question_id) DO UPDATE SET score = EXCLUDED.score, feedback = EXCLUDED.feedback`,
          [submissionId, ans.questionId, ans.score, ans.feedback],
        );
      }
      let total: number;
      if (dto.score !== undefined) {
        total = dto.score; // an explicit total always wins (curving, penalties, file-only work)
      } else if (totalPoints > 0) {
        const sum = await client.query<{ n: number | null }>('SELECT sum(score) AS n FROM answers WHERE submission_id = $1', [submissionId]);
        total = round2(((sum.rows[0].n ?? 0) / totalPoints) * a.max_score);
      } else {
        throw new BadRequestException({ code: 'SCORE_REQUIRED', message: 'Enter a mark for this submission.' });
      }
      await client.query(
        `UPDATE submissions SET score = $2, feedback = $3, status = 'graded', graded_by = $4, graded_at = now(),
                mcq_score = COALESCE((SELECT sum(x.score) FROM answers x JOIN questions q ON q.id = x.question_id WHERE x.submission_id = $1 AND q.kind = 'mcq'), mcq_score)
          WHERE id = $1`,
        [submissionId, total, dto.feedback, user.id],
      );
      return total;
    });

    if (a.results_released) {
      void this.notifications.notify([s.student_id], { type: 'result', title: `Your mark for "${a.title}" was updated`, data: { link: `/app/classes/${a.offering_id}/work/${a.id}` } });
    }
    return { score: final, percent: round2((final / a.max_score) * 100), letter: letterFor((final / a.max_score) * 100) };
  }

  /** The lecturer's switch: until it is on, students cannot see marks, only that work was received. */
  async release(user: AuthUser, assessmentId: string, released: boolean, showAnswers?: boolean) {
    const a = await this.assessments.load(assessmentId);
    await this.access.assertTeach(user, a.offering_id);
    await this.db.query('UPDATE assessments SET results_released = $2, show_answers = COALESCE($3, show_answers), updated_at = now() WHERE id = $1', [assessmentId, released, showAnswers ?? null]);
    const pending = await this.db.query<{ n: number }>(`SELECT count(*) AS n FROM submissions WHERE assessment_id = $1 AND status = 'submitted'`, [assessmentId]);
    if (released && !a.results_released) {
      const { rows } = await this.db.query<{ student_id: string }>(`SELECT student_id FROM submissions WHERE assessment_id = $1 AND status = 'graded'`, [assessmentId]);
      void this.notifications.notify(rows.map((r) => r.student_id), {
        type: 'result', title: `Results released: ${a.title}`, body: 'Your mark is ready to view.',
        data: { link: `/app/classes/${a.offering_id}/work/${assessmentId}` },
      });
    }
    await this.audit.record(user, released ? 'assessment.release' : 'assessment.hide_results', { type: 'assessment', id: assessmentId });
    return { released, ungradedSubmissions: pending.rows[0].n };
  }

  // ---------------------------------------------------------------- gradebook

  async gradebook(user: AuthUser, offeringId: string) {
    await this.access.assertTeach(user, offeringId);
    await this.assessments.finalizeExpired(offeringId);
    const [cols, studs, subs] = await Promise.all([
      this.db.query<{ id: string; title: string; kind: string; max_score: number; weight: number; results_released: boolean }>(
        `SELECT id, title, kind, max_score, weight, results_released FROM assessments WHERE offering_id = $1 AND status <> 'draft' ORDER BY created_at`, [offeringId]),
      this.db.query<{ id: string; display_name: string; reg_number: string | null }>(
        `SELECT u.id, u.display_name, u.reg_number FROM enrolments e JOIN users u ON u.id = e.student_id
          WHERE e.offering_id = $1 AND e.status = 'enrolled' ORDER BY u.reg_number NULLS LAST, u.display_name`, [offeringId]),
      this.db.query<{ assessment_id: string; student_id: string; score: number | null; status: string }>(
        `SELECT s.assessment_id, s.student_id, s.score, s.status FROM submissions s JOIN assessments a ON a.id = s.assessment_id WHERE a.offering_id = $1`, [offeringId]),
    ]);
    const bySub = new Map(subs.rows.map((s) => [`${s.student_id}:${s.assessment_id}`, s]));
    const attendance = await this.attendanceRates(offeringId);
    const students = studs.rows.map((st) => {
      const scores = cols.rows.map((c) => {
        const s = bySub.get(`${st.id}:${c.id}`);
        return { assessmentId: c.id, score: s?.status === 'graded' ? s.score : null, status: s?.status ?? 'not_started' };
      });
      const total = weightedTotal(cols.rows.map((c, i) => ({ score: scores[i].score, maxScore: c.max_score, weight: c.weight })));
      return { id: st.id, name: st.display_name, regNumber: st.reg_number, scores, total, attendancePercent: attendance.get(st.id) ?? null };
    });
    return { columns: cols.rows.map((c) => ({ id: c.id, title: c.title, kind: c.kind, maxScore: c.max_score, weight: c.weight, released: c.results_released })), students };
  }

  async gradebookCsv(user: AuthUser, offeringId: string) {
    const g = await this.gradebook(user, offeringId);
    const header = ['Registration number', 'Name', ...g.columns.map((c) => `${c.title} (/${c.maxScore})`), 'Weighted %', 'Grade', 'Attendance %'];
    const csv = toCsv(header, g.students.map((s) => [s.regNumber ?? '', s.name, ...s.scores.map((x) => x.score ?? ''), s.total.percent ?? '', s.total.letter ?? '', s.attendancePercent ?? '']));
    await this.audit.record(user, 'gradebook.export', { type: 'offering', id: offeringId });
    return csv;
  }

  /** What a student may see: only released, marked work, and a total built from just those items. */
  async myGrades(user: AuthUser, offeringId: string) {
    await this.access.assertEnrolled(user, offeringId);
    const { rows } = await this.db.query<{ id: string; title: string; kind: string; max_score: number; weight: number; status: string | null; score: number | null; released: boolean }>(
      `SELECT a.id, a.title, a.kind, a.max_score, a.weight, s.status, s.score, a.results_released AS released
         FROM assessments a LEFT JOIN submissions s ON s.assessment_id = a.id AND s.student_id = $2
        WHERE a.offering_id = $1 AND a.status <> 'draft' ORDER BY a.created_at`,
      [offeringId, user.id],
    );
    const items = rows.map((r) => {
      const visible = r.released && r.status === 'graded';
      return { assessmentId: r.id, title: r.title, kind: r.kind, maxScore: r.max_score, weight: r.weight,
               status: r.status ?? 'not_started', score: visible ? r.score : null, resultsReleased: r.released };
    });
    const total = weightedTotal(rows.filter((r) => r.released).map((r) => ({ score: r.status === 'graded' ? r.score : null, maxScore: r.max_score, weight: r.weight })));
    const attendance = (await this.attendanceRates(offeringId)).get(user.id) ?? null;
    return { items, total, attendancePercent: attendance };
  }

  private async attendanceRates(offeringId: string): Promise<Map<string, number>> {
    const { rows } = await this.db.query<{ student_id: string; pct: number }>(
      `SELECT e.student_id,
              round(100.0 * count(r.student_id) / NULLIF((SELECT count(*) FROM attendance_sessions WHERE offering_id = $1), 0), 1) AS pct
         FROM enrolments e LEFT JOIN attendance_sessions s ON s.offering_id = e.offering_id
         LEFT JOIN attendance_records r ON r.session_id = s.id AND r.student_id = e.student_id
        WHERE e.offering_id = $1 AND e.status = 'enrolled' GROUP BY e.student_id`,
      [offeringId],
    );
    return new Map(rows.filter((r) => r.pct !== null).map((r) => [r.student_id, Number(r.pct)]));
  }
}
