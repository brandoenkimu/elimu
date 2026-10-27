import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { toCsv } from '../common/csv';
import { generateTempPassword, hashPassword } from '../common/password';
import type { AuthUser } from '../common/types';
import { DatabaseService } from '../database/database.service';
import { RealtimeBus } from '../realtime/realtime.bus';
import { AuditService } from '../shared/audit.service';
import { MailService } from '../shared/mail.service';
import { NotificationsService } from '../shared/notifications.service';
import { UsersRepository } from '../users/users.repository';
import type { CreateUserDto, ListUsersQuery, UpdateUserDto } from './admin.dto';

const USER_COLUMNS = `u.id, u.email, u.display_name AS "displayName", u.role, u.status, u.reg_number AS "regNumber",
  u.staff_number AS "staffNumber", u.course_id AS "courseId", c.name AS "courseName", u.year_of_study AS "yearOfStudy",
  u.department, u.title, u.created_at AS "createdAt", u.last_login_at AS "lastLoginAt"`;

const uniqueMessage = (err: unknown): string | null => {
  const e = err as { code?: string; constraint?: string };
  if (e.code !== '23505') return null;
  if (e.constraint?.includes('reg_number')) return 'That registration number is already in use.';
  if (e.constraint?.includes('staff_number')) return 'That staff number is already in use.';
  return 'That email address is already in use.';
};

@Injectable()
export class AdminService {
  constructor(
    private readonly db: DatabaseService,
    private readonly users: UsersRepository,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
    private readonly bus: RealtimeBus,
  ) {}

  async stats() {
    const one = async <T>(sql: string) => (await this.db.query<T & Record<string, number>>(sql)).rows[0];
    const [people, academic, coursework, pending] = await Promise.all([
      one<{ students: number; lecturers: number; admins: number; suspended: number }>(
        `SELECT count(*) FILTER (WHERE role='student' AND status='active') AS students,
                count(*) FILTER (WHERE role='lecturer' AND status='active') AS lecturers,
                count(*) FILTER (WHERE role='admin' AND status='active') AS admins,
                count(*) FILTER (WHERE status='suspended') AS suspended FROM users`,
      ),
      one<{ courses: number; units: number; offerings: number; enrolments: number }>(
        `SELECT (SELECT count(*) FROM courses WHERE active) AS courses, (SELECT count(*) FROM units WHERE active) AS units,
                (SELECT count(*) FROM offerings o JOIN terms t ON t.id = o.term_id WHERE t.is_current) AS offerings,
                (SELECT count(*) FROM enrolments e JOIN offerings o ON o.id = e.offering_id JOIN terms t ON t.id = o.term_id
                  WHERE t.is_current AND e.status='enrolled') AS enrolments`,
      ),
      one<{ assessments: number; submissions: number; messages_today: number }>(
        `SELECT (SELECT count(*) FROM assessments WHERE status='published') AS assessments,
                (SELECT count(*) FROM submissions WHERE status <> 'in_progress') AS submissions,
                (SELECT count(*) FROM messages WHERE created_at > now() - interval '24 hours') AS messages_today`,
      ),
      one<{ n: number }>(`SELECT count(*) AS n FROM users WHERE status = 'pending'`),
    ]);
    const unassigned = await one<{ n: number }>(
      `SELECT count(*) AS n FROM offerings o JOIN terms t ON t.id = o.term_id WHERE t.is_current AND o.lecturer_id IS NULL`,
    );
    return {
      students: people.students, lecturers: people.lecturers, admins: people.admins, suspended: people.suspended,
      pendingApprovals: pending.n, courses: academic.courses, units: academic.units,
      classesThisTerm: academic.offerings, registrationsThisTerm: academic.enrolments,
      classesWithoutLecturer: unassigned.n,
      publishedAssessments: coursework.assessments, submissions: coursework.submissions, messagesToday: coursework.messages_today,
    };
  }

  async listUsers(q: ListUsersQuery) {
    const like = q.q ? `%${q.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
    const where = `($1::text IS NULL OR u.role = $1) AND ($2::text IS NULL OR u.status = $2)
       AND ($3::text IS NULL OR u.display_name ILIKE $3 OR u.email ILIKE $3 OR u.reg_number ILIKE $3 OR u.staff_number ILIKE $3)`;
    const params = [q.role ?? null, q.status ?? null, like];
    const [rows, total] = await Promise.all([
      this.db.query(
        `SELECT ${USER_COLUMNS} FROM users u LEFT JOIN courses c ON c.id = u.course_id
          WHERE ${where} ORDER BY u.created_at DESC LIMIT $4 OFFSET $5`,
        [...params, q.limit, q.offset],
      ),
      this.db.query<{ n: number }>(`SELECT count(*) AS n FROM users u WHERE ${where}`, params),
    ]);
    return { users: rows.rows, total: total.rows[0].n };
  }

  async getUser(id: string) {
    const { rows } = await this.db.query(`SELECT ${USER_COLUMNS} FROM users u LEFT JOIN courses c ON c.id = u.course_id WHERE u.id = $1`, [id]);
    if (!rows[0]) throw new NotFoundException({ code: 'NOT_FOUND', message: 'User not found.' });
    const classes = await this.db.query(
      `SELECT o.id, un.code AS "unitCode", un.name AS "unitName", t.name AS "termName"
         FROM offerings o JOIN units un ON un.id = o.unit_id JOIN terms t ON t.id = o.term_id
        WHERE o.lecturer_id = $1 OR EXISTS (SELECT 1 FROM enrolments e WHERE e.offering_id = o.id AND e.student_id = $1 AND e.status = 'enrolled')
        ORDER BY t.is_current DESC, t.academic_year DESC, un.code`,
      [id],
    );
    return { user: rows[0], classes: classes.rows };
  }

  /** Creates an account with a one-time temporary password the person must change at first sign-in. */
  async createUser(actor: AuthUser, dto: CreateUserDto, ip: string) {
    const temp = generateTempPassword();
    try {
      const row = await this.users.create({
        email: dto.email,
        displayName: dto.displayName,
        passwordHash: await hashPassword(temp),
        role: dto.role,
        status: 'active',
        regNumber: dto.role === 'student' ? dto.regNumber : null,
        staffNumber: dto.role === 'lecturer' ? dto.staffNumber : null,
        courseId: dto.role === 'student' ? (dto.courseId ?? null) : null,
        yearOfStudy: dto.role === 'student' ? (dto.yearOfStudy ?? 1) : null,
        department: dto.department ?? null,
        title: dto.title || null,
        mustChangePassword: true,
      });
      await this.audit.record(actor, 'user.create', { type: 'user', id: row.id }, { role: dto.role, email: dto.email }, ip);
      const emailed = await this.mail.sendWelcome(row.email, row.display_name, temp);
      // The password is shown to the admin once. It is only a placeholder that must be changed at first sign-in.
      return { id: row.id, temporaryPassword: temp, emailed };
    } catch (err) {
      const msg = uniqueMessage(err);
      if (msg) throw new ConflictException({ code: 'DUPLICATE', message: msg });
      throw err;
    }
  }

  async updateUser(actor: AuthUser, id: string, dto: UpdateUserDto, ip: string) {
    const current = await this.db.query<{ role: string; status: string }>('SELECT role, status FROM users WHERE id = $1', [id]);
    const before = current.rows[0];
    if (!before) throw new NotFoundException({ code: 'NOT_FOUND', message: 'User not found.' });

    if (id === actor.id && ((dto.role && dto.role !== 'admin') || (dto.status && dto.status !== 'active'))) {
      throw new BadRequestException({ code: 'SELF_LOCKOUT', message: 'You cannot demote or suspend your own account.' });
    }
    if (before.role === 'admin' && ((dto.role && dto.role !== 'admin') || (dto.status && dto.status !== 'active'))) {
      const others = await this.db.query(`SELECT 1 FROM users WHERE role = 'admin' AND status = 'active' AND id <> $1 LIMIT 1`, [id]);
      if (!others.rowCount) throw new BadRequestException({ code: 'LAST_ADMIN', message: 'There must be at least one active administrator.' });
    }

    const map: Record<keyof UpdateUserDto, string> = {
      displayName: 'display_name', email: 'email', role: 'role', status: 'status', regNumber: 'reg_number',
      staffNumber: 'staff_number', courseId: 'course_id', yearOfStudy: 'year_of_study', department: 'department', title: 'title',
    };
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, column] of Object.entries(map)) {
      const v = (dto as Record<string, unknown>)[key];
      if (v !== undefined) {
        values.push(v);
        sets.push(`${column} = $${values.length + 1}`);
      }
    }
    if (!sets.length) return;
    try {
      await this.db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1`, [id, ...values]);
    } catch (err) {
      const msg = uniqueMessage(err);
      if (msg) throw new ConflictException({ code: 'DUPLICATE', message: msg });
      throw err;
    }
    // A role or status change must take effect immediately, not when the 15-minute token runs out.
    if ((dto.role && dto.role !== before.role) || (dto.status && dto.status !== 'active')) {
      await this.auth.revokeAll(id);
      this.bus.disconnectUser(id);
    }
    if (dto.status === 'active' && before.status === 'pending') {
      void this.notifications.notify([id], { type: 'account_approved', title: 'Your account is approved', body: 'You can now sign in.' });
    }
    await this.audit.record(actor, 'user.update', { type: 'user', id }, { ...dto, previousRole: before.role, previousStatus: before.status }, ip);
  }

  async resetPassword(actor: AuthUser, id: string, ip: string) {
    const target = await this.db.query<{ email: string; display_name: string }>('SELECT email, display_name FROM users WHERE id = $1', [id]);
    if (!target.rows[0]) throw new NotFoundException({ code: 'NOT_FOUND', message: 'User not found.' });
    const temp = generateTempPassword();
    await this.db.query('UPDATE users SET password_hash = $2, must_change_password = true WHERE id = $1', [id, await hashPassword(temp)]);
    await this.auth.revokeAll(id);
    this.bus.disconnectUser(id);
    await this.audit.record(actor, 'user.reset_password', { type: 'user', id }, {}, ip);
    const emailed = await this.mail.sendWelcome(target.rows[0].email, target.rows[0].display_name, temp);
    return { temporaryPassword: temp, emailed };
  }

  async auditLog(before: number | undefined, limit: number) {
    return this.audit.list(before, limit);
  }

  // ---------------------------------------------------------------- reports

  async usersCsv(actor: AuthUser, role: 'student' | 'lecturer') {
    const { rows } = await this.db.query<Record<string, string | number | null>>(
      `SELECT u.display_name, u.email, u.reg_number, u.staff_number, c.name AS course, u.year_of_study, u.department, u.status, u.created_at
         FROM users u LEFT JOIN courses c ON c.id = u.course_id WHERE u.role = $1 ORDER BY u.display_name`,
      [role],
    );
    await this.audit.record(actor, 'report.export', { type: 'users', id: role });
    if (role === 'student') {
      return toCsv(['Registration number', 'Name', 'Email', 'Course', 'Year', 'Status', 'Created'],
        rows.map((r) => [r.reg_number, r.display_name, r.email, r.course, r.year_of_study, r.status, r.created_at ? new Date(r.created_at as unknown as string).toISOString().slice(0, 10) : '']));
    }
    return toCsv(['Staff number', 'Name', 'Email', 'Department', 'Status', 'Created'],
      rows.map((r) => [r.staff_number, r.display_name, r.email, r.department, r.status, r.created_at ? new Date(r.created_at as unknown as string).toISOString().slice(0, 10) : '']));
  }
}
