import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../common/types';
import { toCsv } from '../common/csv';
import { ConversationsService } from '../conversations/conversations.service';
import { DatabaseService } from '../database/database.service';
import { AccessService } from '../shared/access.service';
import { AuditService } from '../shared/audit.service';
import { NotificationsService } from '../shared/notifications.service';

const OFFERING_COLUMNS = `
  o.id, o.capacity, un.code AS "unitCode", un.name AS "unitName", un.year_of_study AS "yearOfStudy",
  un.semester, un.credit_hours AS "creditHours", un.description,
  c.id AS "courseId", c.name AS "courseName",
  t.id AS "termId", t.name AS "termName", t.is_current AS "isCurrentTerm",
  l.id AS "lecturerId", l.display_name AS "lecturerName", l.title AS "lecturerTitle",
  (SELECT count(*) FROM enrolments e WHERE e.offering_id = o.id AND e.status = 'enrolled') AS enrolled,
  (SELECT id FROM conversations cv WHERE cv.offering_id = o.id AND cv.kind = 'class') AS "classChatId"`;

const OFFERING_FROM = `
  FROM offerings o
  JOIN units un ON un.id = o.unit_id
  JOIN courses c ON c.id = un.course_id
  JOIN terms t ON t.id = o.term_id
  LEFT JOIN users l ON l.id = o.lecturer_id`;

@Injectable()
export class EnrolmentService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly conversations: ConversationsService,
  ) {}

  /** Classes the signed-in person is part of: registered (student) or teaching (lecturer). */
  async mine(user: AuthUser) {
    if (user.role === 'admin') return [];
    const { rows } = await this.db.query(
      user.role === 'student'
        ? `SELECT ${OFFERING_COLUMNS} ${OFFERING_FROM}
            JOIN enrolments en ON en.offering_id = o.id AND en.student_id = $1 AND en.status = 'enrolled'
           ORDER BY t.is_current DESC, t.academic_year DESC, un.code`
        : `SELECT ${OFFERING_COLUMNS} ${OFFERING_FROM}
            WHERE o.lecturer_id = $1
            ORDER BY t.is_current DESC, t.academic_year DESC, un.code`,
      [user.id],
    );
    return rows;
  }

  async detail(user: AuthUser, offeringId: string) {
    await this.access.assertView(user, offeringId);
    const { rows } = await this.db.query(`SELECT ${OFFERING_COLUMNS} ${OFFERING_FROM} WHERE o.id = $1`, [offeringId]);
    return rows[0];
  }

  // ---------------------------------------------------------------- student registration

  async registrationOverview(user: AuthUser) {
    const me = await this.db.query<{ course_id: string | null; year_of_study: number | null }>(
      'SELECT course_id, year_of_study FROM users WHERE id = $1',
      [user.id],
    );
    const profile = me.rows[0];
    const term = await this.db.query<{ id: string; name: string; semester: number; registration_open: boolean }>(
      'SELECT id, name, semester, registration_open FROM terms WHERE is_current',
    );
    if (!term.rows[0] || !profile?.course_id) {
      return { term: term.rows[0] ?? null, registrationOpen: false, hasCourse: !!profile?.course_id, yearOfStudy: profile?.year_of_study ?? null, offerings: [] };
    }
    const { rows } = await this.db.query(
      `SELECT ${OFFERING_COLUMNS},
              EXISTS (SELECT 1 FROM enrolments en WHERE en.offering_id = o.id AND en.student_id = $1 AND en.status = 'enrolled') AS registered
         ${OFFERING_FROM}
        WHERE o.term_id = $2 AND un.course_id = $3 AND un.active
        ORDER BY un.year_of_study, un.code`,
      [user.id, term.rows[0].id, profile.course_id],
    );
    return {
      term: { id: term.rows[0].id, name: term.rows[0].name, semester: term.rows[0].semester },
      registrationOpen: term.rows[0].registration_open,
      hasCourse: true,
      yearOfStudy: profile.year_of_study,
      offerings: rows,
    };
  }

  async register(user: AuthUser, offeringIds: string[]) {
    const ids = [...new Set(offeringIds)];
    const me = await this.db.query<{ course_id: string | null }>('SELECT course_id FROM users WHERE id = $1', [user.id]);
    const courseId = me.rows[0]?.course_id;
    if (!courseId) throw new ConflictException({ code: 'NO_COURSE', message: 'Choose your course in your profile first.' });

    const registered: string[] = [];
    await this.db.transaction(async (client) => {
      const term = await client.query<{ id: string; registration_open: boolean }>('SELECT id, registration_open FROM terms WHERE is_current');
      if (!term.rows[0]?.registration_open) {
        throw new ForbiddenException({ code: 'REGISTRATION_CLOSED', message: 'Unit registration is not open right now.' });
      }
      // Lock the rows so two students cannot both take the last seat.
      const { rows } = await client.query<{ id: string; capacity: number | null; course_id: string; term_id: string }>(
        `SELECT o.id, o.capacity, un.course_id, o.term_id
           FROM offerings o JOIN units un ON un.id = o.unit_id
          WHERE o.id = ANY($1::uuid[]) ORDER BY o.id FOR UPDATE OF o`,
        [ids],
      );
      if (rows.length !== ids.length) throw new NotFoundException({ code: 'NOT_FOUND', message: 'One of the units is not available.' });
      for (const o of rows) {
        if (o.course_id !== courseId || o.term_id !== term.rows[0].id) {
          throw new ForbiddenException({ code: 'NOT_YOUR_COURSE', message: 'You can only register units from your own course this semester.' });
        }
        const already = await client.query(`SELECT 1 FROM enrolments WHERE offering_id = $1 AND student_id = $2 AND status = 'enrolled'`, [o.id, user.id]);
        if (already.rowCount) continue;
        if (o.capacity !== null) {
          const n = await client.query<{ n: number }>(`SELECT count(*) AS n FROM enrolments WHERE offering_id = $1 AND status = 'enrolled'`, [o.id]);
          if (n.rows[0].n >= o.capacity) throw new ConflictException({ code: 'FULL', message: 'One of the units is full.' });
        }
        await client.query(
          `INSERT INTO enrolments (offering_id, student_id, status) VALUES ($1, $2, 'enrolled')
           ON CONFLICT (offering_id, student_id) DO UPDATE SET status = 'enrolled', enrolled_at = now()`,
          [o.id, user.id],
        );
        registered.push(o.id);
      }
    });
    for (const id of registered) await this.conversations.addToClassGroup(id, user.id);
    await this.audit.record(user, 'registration.add', { type: 'student', id: user.id }, { offerings: registered });
    return { registered: registered.length };
  }

  async drop(user: AuthUser, offeringId: string) {
    const term = await this.db.query<{ registration_open: boolean }>(
      `SELECT t.registration_open FROM offerings o JOIN terms t ON t.id = o.term_id WHERE o.id = $1`,
      [offeringId],
    );
    if (!term.rows[0]) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Class not found.' });
    if (!term.rows[0].registration_open) {
      throw new ForbiddenException({ code: 'REGISTRATION_CLOSED', message: 'Units can only be dropped while registration is open. Contact your administrator.' });
    }
    const r = await this.db.query(`UPDATE enrolments SET status = 'dropped' WHERE offering_id = $1 AND student_id = $2 AND status = 'enrolled'`, [offeringId, user.id]);
    if (!r.rowCount) throw new NotFoundException({ code: 'NOT_FOUND', message: 'You are not registered for this unit.' });
    await this.conversations.removeFromClassGroup(offeringId, user.id);
    await this.audit.record(user, 'registration.drop', { type: 'offering', id: offeringId });
  }

  // ---------------------------------------------------------------- admin overrides

  async adminEnrol(actor: AuthUser, offeringId: string, studentId: string) {
    const student = await this.db.query(`SELECT 1 FROM users WHERE id = $1 AND role = 'student' AND status = 'active'`, [studentId]);
    if (!student.rowCount) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Student not found.' });
    if (!(await this.access.getOffering(offeringId))) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Class not found.' });
    await this.db.query(
      `INSERT INTO enrolments (offering_id, student_id, status) VALUES ($1, $2, 'enrolled')
       ON CONFLICT (offering_id, student_id) DO UPDATE SET status = 'enrolled', enrolled_at = now()`,
      [offeringId, studentId],
    );
    await this.conversations.addToClassGroup(offeringId, studentId);
    await this.audit.record(actor, 'enrolment.add', { type: 'offering', id: offeringId }, { studentId });
    void this.notifications.notify([studentId], { type: 'enrolment', title: 'You were registered for a unit', data: { link: `/app/classes/${offeringId}` } });
  }

  async adminUnenrol(actor: AuthUser, offeringId: string, studentId: string) {
    const r = await this.db.query(`UPDATE enrolments SET status = 'dropped' WHERE offering_id = $1 AND student_id = $2 AND status = 'enrolled'`, [offeringId, studentId]);
    if (!r.rowCount) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Registration not found.' });
    await this.conversations.removeFromClassGroup(offeringId, studentId);
    await this.audit.record(actor, 'enrolment.remove', { type: 'offering', id: offeringId }, { studentId });
  }

  // ---------------------------------------------------------------- roster

  async roster(user: AuthUser, offeringId: string) {
    await this.access.assertTeach(user, offeringId);
    const { rows } = await this.db.query(
      `SELECT s.id, s.display_name AS "displayName", s.reg_number AS "regNumber", s.email,
              s.year_of_study AS "yearOfStudy", c.name AS "courseName", e.enrolled_at AS "enrolledAt"
         FROM enrolments e
         JOIN users s ON s.id = e.student_id
         LEFT JOIN courses c ON c.id = s.course_id
        WHERE e.offering_id = $1 AND e.status = 'enrolled'
        ORDER BY s.reg_number NULLS LAST, s.display_name`,
      [offeringId],
    );
    return rows as Array<{ id: string; displayName: string; regNumber: string | null; email: string; yearOfStudy: number | null; courseName: string | null; enrolledAt: Date }>;
  }

  async rosterCsv(user: AuthUser, offeringId: string): Promise<{ filename: string; csv: string }> {
    const rows = await this.roster(user, offeringId);
    const meta = await this.db.query<{ code: string }>(`SELECT un.code FROM offerings o JOIN units un ON un.id = o.unit_id WHERE o.id = $1`, [offeringId]);
    const csv = toCsv(
      ['No.', 'Registration number', 'Name', 'Email', 'Course', 'Year', 'Registered on'],
      rows.map((r, i) => [i + 1, r.regNumber ?? '', r.displayName, r.email, r.courseName ?? '', r.yearOfStudy ?? '', new Date(r.enrolledAt).toISOString().slice(0, 10)]),
    );
    await this.audit.record(user, 'roster.export', { type: 'offering', id: offeringId });
    return { filename: `${(meta.rows[0]?.code ?? 'class').replace(/[^A-Za-z0-9_-]/g, '')}-class-list.csv`, csv };
  }
}
