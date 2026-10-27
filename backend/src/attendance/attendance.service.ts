import { randomInt } from 'node:crypto';
import { ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { z } from 'zod';
import { toCsv } from '../common/csv';
import type { AuthUser } from '../common/types';
import { oneLine } from '../common/zod-helpers';
import { DatabaseService } from '../database/database.service';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { AccessService } from '../shared/access.service';

export const startSessionSchema = z.object({ title: oneLine(100, 2), minutes: z.number().int().min(1).max(180).default(15) }).strict();
export const checkInSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'The code is 6 digits.') }).strict();
export const markSchema = z.object({ present: z.boolean() }).strict();

@Injectable()
export class AttendanceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessService,
    private readonly limiter: RateLimitService,
  ) {}

  async start(user: AuthUser, offeringId: string, dto: z.infer<typeof startSessionSchema>) {
    await this.access.assertTeach(user, offeringId);
    // Only one live code per class at a time keeps check-in unambiguous.
    await this.db.query(`UPDATE attendance_sessions SET closes_at = now() WHERE offering_id = $1 AND closes_at > now() AND opens_at <= now()`, [offeringId]);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const { rows } = await this.db.query<{ id: string; closes_at: Date }>(
      `INSERT INTO attendance_sessions (offering_id, title, code, opens_at, closes_at, created_by)
       VALUES ($1,$2,$3, now(), now() + make_interval(mins => $4), $5) RETURNING id, closes_at`,
      [offeringId, dto.title, code, dto.minutes, user.id],
    );
    return { id: rows[0].id, code, closesAt: rows[0].closes_at.toISOString() };
  }

  async list(user: AuthUser, offeringId: string) {
    const offering = await this.access.assertView(user, offeringId);
    const teacher = user.role === 'admin' || offering.lecturer_id === user.id;
    if (teacher) {
      const { rows } = await this.db.query(
        `SELECT s.id, s.title, s.opens_at AS "opensAt", s.closes_at AS "closesAt", (s.closes_at > now()) AS live,
                CASE WHEN s.closes_at > now() THEN s.code ELSE NULL END AS code,
                (SELECT count(*) FROM attendance_records r WHERE r.session_id = s.id) AS present,
                (SELECT count(*) FROM enrolments e WHERE e.offering_id = s.offering_id AND e.status = 'enrolled') AS total
           FROM attendance_sessions s WHERE s.offering_id = $1 ORDER BY s.opens_at DESC LIMIT 100`,
        [offeringId],
      );
      return rows;
    }
    const { rows } = await this.db.query(
      `SELECT s.id, s.title, s.opens_at AS "opensAt", s.closes_at AS "closesAt", (s.closes_at > now()) AS live,
              (r.student_id IS NOT NULL) AS present, r.checked_in_at AS "checkedInAt"
         FROM attendance_sessions s LEFT JOIN attendance_records r ON r.session_id = s.id AND r.student_id = $2
        WHERE s.offering_id = $1 ORDER BY s.opens_at DESC LIMIT 100`,
      [offeringId, user.id],
    );
    return rows;
  }

  async checkIn(user: AuthUser, offeringId: string, code: string) {
    await this.access.assertEnrolled(user, offeringId);
    // 6 digits can be guessed, so attempts are limited per student and shared across all nodes.
    const attempt = await this.limiter.consume('checkin', user.id, 8, 300, true);
    if (attempt.unavailable) throw new ServiceUnavailableException({ code: 'SERVICE_UNAVAILABLE', message: 'Check-in is temporarily unavailable.' });
    if (!attempt.allowed) {
      throw new HttpException({ code: 'RATE_LIMITED', message: `Too many tries. Wait ${attempt.retryAfterSec} seconds.`, retryAfterSec: attempt.retryAfterSec }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const { rows } = await this.db.query<{ id: string; title: string }>(
      `SELECT id, title FROM attendance_sessions WHERE offering_id = $1 AND code = $2 AND opens_at <= now() AND closes_at > now()`,
      [offeringId, code],
    );
    if (!rows[0]) throw new ForbiddenException({ code: 'BAD_CODE', message: 'That code is wrong or the session has closed.' });
    const r = await this.db.query(
      `INSERT INTO attendance_records (session_id, student_id, method) VALUES ($1,$2,'code') ON CONFLICT DO NOTHING`,
      [rows[0].id, user.id],
    );
    return { title: rows[0].title, alreadyCheckedIn: !r.rowCount };
  }

  async close(user: AuthUser, sessionId: string) {
    const s = await this.session(sessionId);
    await this.access.assertTeach(user, s.offering_id);
    await this.db.query('UPDATE attendance_sessions SET closes_at = now() WHERE id = $1 AND closes_at > now()', [sessionId]);
  }

  async roster(user: AuthUser, sessionId: string) {
    const s = await this.session(sessionId);
    await this.access.assertTeach(user, s.offering_id);
    const { rows } = await this.db.query(
      `SELECT u.id, u.display_name AS "name", u.reg_number AS "regNumber", (r.student_id IS NOT NULL) AS present,
              r.checked_in_at AS "checkedInAt", r.method
         FROM enrolments e JOIN users u ON u.id = e.student_id
         LEFT JOIN attendance_records r ON r.session_id = $1 AND r.student_id = u.id
        WHERE e.offering_id = $2 AND e.status = 'enrolled' ORDER BY u.reg_number NULLS LAST, u.display_name`,
      [sessionId, s.offering_id],
    );
    return { session: { id: s.id, title: s.title, opensAt: s.opens_at }, students: rows };
  }

  async mark(user: AuthUser, sessionId: string, studentId: string, present: boolean) {
    const s = await this.session(sessionId);
    await this.access.assertTeach(user, s.offering_id);
    if (!(await this.access.isEnrolled(studentId, s.offering_id))) throw new ConflictException({ code: 'NOT_ENROLLED', message: 'That student is not registered for this unit.' });
    if (present) {
      await this.db.query(`INSERT INTO attendance_records (session_id, student_id, method) VALUES ($1,$2,'manual') ON CONFLICT DO NOTHING`, [sessionId, studentId]);
    } else {
      await this.db.query('DELETE FROM attendance_records WHERE session_id = $1 AND student_id = $2', [sessionId, studentId]);
    }
  }

  async csv(user: AuthUser, sessionId: string) {
    const { students } = await this.roster(user, sessionId);
    return toCsv(
      ['Registration number', 'Name', 'Status', 'Checked in at'],
      (students as Array<{ regNumber: string | null; name: string; present: boolean; checkedInAt: Date | null }>).map((s) => [
        s.regNumber ?? '', s.name, s.present ? 'Present' : 'Absent', s.checkedInAt ? new Date(s.checkedInAt).toISOString() : '',
      ]),
    );
  }

  private async session(id: string) {
    const { rows } = await this.db.query<{ id: string; offering_id: string; title: string; opens_at: Date }>('SELECT id, offering_id, title, opens_at FROM attendance_sessions WHERE id = $1', [id]);
    if (!rows[0]) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Session not found.' });
    return rows[0];
  }
}
