import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { cleanText, oneLine, uuid } from '../common/zod-helpers';
import type { AuthUser } from '../common/types';
import { DatabaseService } from '../database/database.service';
import { SelfUser, UsersRepository, toSelfUser } from '../users/users.repository';
import { CARD_COLUMNS, CARD_FROM, ConnectionsService, PersonCard, RelationInfo, toCard } from './connections.service';

const phone = z
  .string()
  .trim()
  .max(24)
  .refine((s) => s === '' || /^[+0-9 ()\-]{7,24}$/.test(s), 'Enter a valid phone number.');

export const updateProfileSchema = z
  .object({
    displayName: oneLine(80, 2).refine((s) => /^[\p{L}\p{N} .'\-]+$/u.test(s), "Use letters, numbers, spaces and . ' - only."),
    phone,
    bio: cleanText(500),
    yearOfStudy: z.coerce.number().int().min(1).max(7),
    courseId: uuid,
    title: oneLine(24, 0),
    department: oneLine(100, 2),
    office: oneLine(100, 0),
    officeHours: oneLine(200, 0),
  })
  .partial()
  .strict();

export const preferencesSchema = z
  .object({
    surface: z.enum(['system', 'white', 'beige', 'carbon', 'navy', 'midnight']),
    accent: z.enum(['electric', 'ocean', 'cyan', 'emerald', 'royal', 'purple', 'crimson', 'gold', 'orange', 'pink']),
    fontSize: z.enum(['sm', 'md', 'lg']),
    density: z.enum(['comfortable', 'compact']),
    showServerDetails: z.boolean(),
    allowRequests: z.boolean(),
    showEmail: z.boolean(),
  })
  .partial()
  .strict();

export const searchSchema = z.object({
  q: z.string().trim().min(2).max(60),
  role: z.enum(['student', 'lecturer']).optional(),
});

export type UpdateProfileDto = z.infer<typeof updateProfileSchema>;
export type PreferencesDto = z.infer<typeof preferencesSchema>;

export interface PublicProfile extends PersonCard {
  bio: string;
  email: string | null;
  office: string | null;
  officeHours: string | null;
  memberSince: string;
  sharedClasses: { offeringId: string; unitCode: string; unitName: string }[];
  relation: RelationInfo['relation'];
  connectionId: string | null;
}

@Injectable()
export class PeopleService {
  constructor(
    private readonly db: DatabaseService,
    private readonly users: UsersRepository,
    private readonly connections: ConnectionsService,
  ) {}

  async updateProfile(me: AuthUser, dto: UpdateProfileDto): Promise<SelfUser> {
    const current = await this.users.findById(me.id);
    if (!current) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Account not found.' });

    const sets: string[] = [];
    const values: unknown[] = [me.id];
    const set = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };

    if (dto.displayName !== undefined) set('display_name', dto.displayName);
    if (dto.phone !== undefined) set('phone', dto.phone === '' ? null : dto.phone);
    if (dto.bio !== undefined) set('bio', dto.bio);

    if (me.role === 'student') {
      let courseId = current.course_id;
      if (dto.courseId !== undefined && dto.courseId !== current.course_id) {
        if (current.course_id) {
          throw new ConflictException({
            code: 'COURSE_LOCKED',
            message: 'Your programme can only be changed by an administrator.',
          });
        }
        courseId = dto.courseId;
        set('course_id', courseId);
      }
      if (dto.yearOfStudy !== undefined || dto.courseId !== undefined) {
        const year = dto.yearOfStudy ?? current.year_of_study ?? 1;
        if (courseId) {
          const { rows } = await this.db.query<{ duration_years: number }>(
            'SELECT duration_years FROM courses WHERE id = $1 AND active',
            [courseId],
          );
          if (!rows[0]) {
            throw new BadRequestException({
              code: 'VALIDATION_FAILED',
              message: 'Choose one of the listed programmes.',
              issues: [{ field: 'courseId', message: 'Choose one of the listed programmes.' }],
            });
          }
          if (year > rows[0].duration_years) {
            throw new BadRequestException({
              code: 'VALIDATION_FAILED',
              message: `This programme runs for ${rows[0].duration_years} year(s).`,
              issues: [{ field: 'yearOfStudy', message: `This programme runs for ${rows[0].duration_years} year(s).` }],
            });
          }
        }
        set('year_of_study', year);
      }
    }
    if (me.role === 'lecturer') {
      if (dto.title !== undefined) set('title', dto.title || null);
      if (dto.department !== undefined) set('department', dto.department);
      if (dto.office !== undefined) set('office', dto.office || null);
      if (dto.officeHours !== undefined) set('office_hours', dto.officeHours || null);
    }

    if (sets.length > 0) await this.db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1`, values);
    return toSelfUser((await this.users.findById(me.id))!);
  }

  async updatePreferences(me: AuthUser, dto: PreferencesDto): Promise<Record<string, unknown>> {
    const { rows } = await this.db.query<{ preferences: Record<string, unknown> }>(
      `UPDATE users SET preferences = preferences || $2::jsonb WHERE id = $1 RETURNING preferences`,
      [me.id, JSON.stringify(dto)],
    );
    return rows[0].preferences;
  }

  async search(me: AuthUser, q: string, role?: 'student' | 'lecturer') {
    const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const { rows } = await this.db.query<
      { id: string; display_name: string; role: 'student' | 'lecturer'; title: string | null; department: string | null; course_name: string | null; year_of_study: number | null }
    >(
      `SELECT ${CARD_COLUMNS}
         FROM ${CARD_FROM}
        WHERE u.status = 'active' AND u.role IN ('student', 'lecturer') AND u.id <> $1
          AND ($3::text IS NULL OR u.role = $3)
          AND (u.display_name ILIKE $2 OR upper(u.reg_number) = upper($4) OR upper(u.staff_number) = upper($4))
          AND NOT EXISTS (
            SELECT 1 FROM connections b
             WHERE b.status = 'blocked' AND b.requester_id = u.id AND b.addressee_id = $1
          )
        ORDER BY u.display_name ASC
        LIMIT 20`,
      [me.id, pattern, role ?? null, q],
    );
    const relations = await this.connections.relations(
      me.id,
      rows.map((r) => r.id),
    );
    return {
      people: rows.map((r) => ({ ...toCard(r), ...relations.get(r.id)! })),
    };
  }

  async suggestions(me: AuthUser) {
    // People in the same classes, not yet connected: the easiest introductions.
    const { rows } = await this.db.query<
      { id: string; display_name: string; role: 'student' | 'lecturer'; title: string | null; department: string | null; course_name: string | null; year_of_study: number | null }
    >(
      `SELECT DISTINCT ${CARD_COLUMNS}
         FROM ${CARD_FROM}
         JOIN enrolments e1 ON e1.student_id = u.id AND e1.status = 'enrolled'
         JOIN enrolments e2 ON e2.offering_id = e1.offering_id AND e2.student_id = $1 AND e2.status = 'enrolled'
        WHERE u.id <> $1 AND u.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM connections k
             WHERE (k.requester_id = $1 AND k.addressee_id = u.id) OR (k.addressee_id = $1 AND k.requester_id = u.id)
          )
        LIMIT 12`,
      [me.id],
    );
    return { people: rows.map((r) => ({ ...toCard(r), relation: 'none' as const, connectionId: null })) };
  }

  async publicProfile(me: AuthUser, userId: string): Promise<PublicProfile> {
    const { rows } = await this.db.query<
      {
        id: string;
        display_name: string;
        role: 'student' | 'lecturer';
        title: string | null;
        department: string | null;
        course_name: string | null;
        year_of_study: number | null;
        bio: string;
        email: string;
        office: string | null;
        office_hours: string | null;
        created_at: Date;
        show_email: string | null;
      }
    >(
      `SELECT ${CARD_COLUMNS}, u.bio, u.email, u.office, u.office_hours, u.created_at,
              u.preferences->>'showEmail' AS show_email
         FROM ${CARD_FROM}
        WHERE u.id = $1 AND u.status = 'active' AND u.role IN ('student', 'lecturer')`,
      [userId],
    );
    const row = rows[0];
    const relation = row ? (await this.connections.relations(me.id, [userId])).get(userId)! : null;
    if (!row || !relation || relation.relation === 'blocked') {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'That person could not be found.' });
    }

    const shared = await this.db.query<{ id: string; code: string; name: string }>(
      `SELECT o.id, un.code, un.name
         FROM offerings o JOIN units un ON un.id = o.unit_id
        WHERE EXISTS (SELECT 1 FROM enrolments e WHERE e.offering_id = o.id AND e.status = 'enrolled' AND e.student_id = $1)
          AND (o.lecturer_id = $2 OR EXISTS (SELECT 1 FROM enrolments e WHERE e.offering_id = o.id AND e.status = 'enrolled' AND e.student_id = $2))
        ORDER BY un.code`,
      [row.role === 'student' ? row.id : me.id, row.role === 'student' ? me.id : row.id],
    );
    // For two students the query above lists classes where both are enrolled; for a student/lecturer
    // pair it lists classes the lecturer teaches that the student attends.
    const sharedClasses = shared.rows.map((s) => ({ offeringId: s.id, unitCode: s.code, unitName: s.name }));

    // Lecturers show their email by default (students need to reach them); students hide it unless they opt in.
    const showEmail = row.show_email === null ? row.role === 'lecturer' : row.show_email === 'true';

    return {
      ...toCard(row),
      bio: row.bio,
      email: showEmail || me.role === 'admin' ? row.email : null,
      office: row.role === 'lecturer' ? row.office : null,
      officeHours: row.role === 'lecturer' ? row.office_hours : null,
      memberSince: row.created_at.toISOString(),
      sharedClasses,
      relation: relation.relation,
      connectionId: relation.connectionId,
    };
  }
}
