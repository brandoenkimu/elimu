import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../common/types';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../shared/audit.service';
import type { CourseDto, OfferingDto, TermDto, UnitDto } from './academic.dto';

type Patch = Record<string, unknown>;

/** Builds "col = $n" pairs from a fixed field→column map, so column names never come from user input. */
function buildSet(patch: Patch, columns: Record<string, string>, startAt = 2) {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of Object.entries(columns)) {
    if (patch[key] !== undefined) {
      values.push(patch[key]);
      sets.push(`${column} = $${startAt + values.length - 1}`);
    }
  }
  return { sets, values };
}

const isUnique = (err: unknown) => (err as { code?: string }).code === '23505';
const isFk = (err: unknown) => (err as { code?: string }).code === '23503';
const notFound = (what: string) => new NotFoundException({ code: 'NOT_FOUND', message: `${what} not found.` });
const dup = (message: string) => new ConflictException({ code: 'DUPLICATE', message });

@Injectable()
export class CatalogService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- courses

  async publicCourses() {
    const { rows } = await this.db.query(
      `SELECT id, code, name, department, duration_years AS "durationYears", semesters_per_year AS "semestersPerYear"
         FROM courses WHERE active ORDER BY name`,
    );
    return rows;
  }

  async listCourses() {
    const { rows } = await this.db.query(
      `SELECT c.id, c.code, c.name, c.department, c.duration_years AS "durationYears",
              c.semesters_per_year AS "semestersPerYear", c.active,
              (SELECT count(*) FROM units u WHERE u.course_id = c.id) AS "unitCount",
              (SELECT count(*) FROM users s WHERE s.course_id = c.id AND s.role = 'student') AS "studentCount"
         FROM courses c ORDER BY c.name`,
    );
    return rows;
  }

  async createCourse(actor: AuthUser, dto: CourseDto) {
    try {
      const { rows } = await this.db.query<{ id: string }>(
        `INSERT INTO courses (code, name, department, duration_years, semesters_per_year, active)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [dto.code, dto.name, dto.department, dto.durationYears, dto.semestersPerYear, dto.active],
      );
      await this.audit.record(actor, 'course.create', { type: 'course', id: rows[0].id }, { code: dto.code });
      return { id: rows[0].id };
    } catch (err) {
      if (isUnique(err)) throw dup('A course with that code already exists.');
      throw err;
    }
  }

  async updateCourse(actor: AuthUser, id: string, patch: Patch) {
    const { sets, values } = buildSet(patch, {
      code: 'code',
      name: 'name',
      department: 'department',
      durationYears: 'duration_years',
      semestersPerYear: 'semesters_per_year',
      active: 'active',
    });
    if (!sets.length) return;
    try {
      const r = await this.db.query(`UPDATE courses SET ${sets.join(', ')} WHERE id = $1`, [id, ...values]);
      if (!r.rowCount) throw notFound('Course');
    } catch (err) {
      if (isUnique(err)) throw dup('A course with that code already exists.');
      throw err;
    }
    await this.audit.record(actor, 'course.update', { type: 'course', id }, patch);
  }

  async deleteCourse(actor: AuthUser, id: string) {
    const students = await this.db.query('SELECT 1 FROM users WHERE course_id = $1 LIMIT 1', [id]);
    if (students.rowCount) {
      throw new ConflictException({ code: 'IN_USE', message: 'Students are registered on this course. Deactivate it instead of deleting.' });
    }
    const r = await this.db.query('DELETE FROM courses WHERE id = $1', [id]);
    if (!r.rowCount) throw notFound('Course');
    await this.audit.record(actor, 'course.delete', { type: 'course', id });
  }

  // ---------------------------------------------------------------- units

  async listUnits(courseId?: string) {
    const { rows } = await this.db.query(
      `SELECT u.id, u.course_id AS "courseId", c.code AS "courseCode", c.name AS "courseName", u.code, u.name,
              u.year_of_study AS "yearOfStudy", u.semester, u.credit_hours AS "creditHours",
              u.description, u.active
         FROM units u JOIN courses c ON c.id = u.course_id
        WHERE ($1::uuid IS NULL OR u.course_id = $1::uuid)
        ORDER BY c.name, u.year_of_study, u.semester, u.code`,
      [courseId ?? null],
    );
    return rows;
  }

  async createUnit(actor: AuthUser, dto: UnitDto) {
    const course = await this.db.query<{ duration_years: number; semesters_per_year: number }>(
      'SELECT duration_years, semesters_per_year FROM courses WHERE id = $1',
      [dto.courseId],
    );
    if (!course.rows[0]) throw notFound('Course');
    this.assertWithinCourse(course.rows[0], dto.yearOfStudy, dto.semester);
    try {
      const { rows } = await this.db.query<{ id: string }>(
        `INSERT INTO units (course_id, code, name, year_of_study, semester, credit_hours, description, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [dto.courseId, dto.code, dto.name, dto.yearOfStudy, dto.semester, dto.creditHours, dto.description, dto.active],
      );
      await this.audit.record(actor, 'unit.create', { type: 'unit', id: rows[0].id }, { code: dto.code });
      return { id: rows[0].id };
    } catch (err) {
      if (isUnique(err)) throw dup('A unit with that code already exists.');
      throw err;
    }
  }

  async updateUnit(actor: AuthUser, id: string, patch: Patch) {
    const { sets, values } = buildSet(patch, {
      courseId: 'course_id',
      code: 'code',
      name: 'name',
      yearOfStudy: 'year_of_study',
      semester: 'semester',
      creditHours: 'credit_hours',
      description: 'description',
      active: 'active',
    });
    if (!sets.length) return;
    try {
      const r = await this.db.query(`UPDATE units SET ${sets.join(', ')} WHERE id = $1`, [id, ...values]);
      if (!r.rowCount) throw notFound('Unit');
    } catch (err) {
      if (isUnique(err)) throw dup('A unit with that code already exists.');
      if (isFk(err)) throw notFound('Course');
      throw err;
    }
    await this.audit.record(actor, 'unit.update', { type: 'unit', id }, patch);
  }

  async deleteUnit(actor: AuthUser, id: string) {
    const used = await this.db.query('SELECT 1 FROM offerings WHERE unit_id = $1 LIMIT 1', [id]);
    if (used.rowCount) {
      throw new ConflictException({ code: 'IN_USE', message: 'This unit has been offered in a term. Deactivate it instead of deleting.' });
    }
    const r = await this.db.query('DELETE FROM units WHERE id = $1', [id]);
    if (!r.rowCount) throw notFound('Unit');
    await this.audit.record(actor, 'unit.delete', { type: 'unit', id });
  }

  private assertWithinCourse(c: { duration_years: number; semesters_per_year: number }, year: number, semester: number) {
    if (year > c.duration_years || semester > c.semesters_per_year) {
      throw new ConflictException({
        code: 'OUT_OF_RANGE',
        message: `This course runs ${c.duration_years} year(s) with ${c.semesters_per_year} semester(s) a year.`,
      });
    }
  }

  // ---------------------------------------------------------------- terms

  async listTerms() {
    const { rows } = await this.db.query(
      `SELECT id, name, academic_year AS "academicYear", semester, starts_on::text AS "startsOn", ends_on::text AS "endsOn",
              registration_open AS "registrationOpen", evaluation_open AS "evaluationOpen", is_current AS "isCurrent"
         FROM terms ORDER BY academic_year DESC, semester DESC`,
    );
    return rows;
  }

  async currentTerm() {
    const { rows } = await this.db.query(
      `SELECT id, name, academic_year AS "academicYear", semester, registration_open AS "registrationOpen",
              evaluation_open AS "evaluationOpen" FROM terms WHERE is_current`,
    );
    return rows[0] ?? null;
  }

  async createTerm(actor: AuthUser, dto: TermDto) {
    try {
      const id = await this.db.transaction(async (client) => {
        if (dto.isCurrent) await client.query('UPDATE terms SET is_current = false WHERE is_current');
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO terms (name, academic_year, semester, starts_on, ends_on, registration_open, evaluation_open, is_current)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [dto.name, dto.academicYear, dto.semester, dto.startsOn, dto.endsOn, dto.registrationOpen, dto.evaluationOpen, dto.isCurrent],
        );
        return rows[0].id;
      });
      await this.audit.record(actor, 'term.create', { type: 'term', id }, { name: dto.name });
      return { id };
    } catch (err) {
      if (isUnique(err)) throw dup('That academic year and semester already exists.');
      throw err;
    }
  }

  async updateTerm(actor: AuthUser, id: string, patch: Patch) {
    const { sets, values } = buildSet(patch, {
      name: 'name',
      academicYear: 'academic_year',
      semester: 'semester',
      startsOn: 'starts_on',
      endsOn: 'ends_on',
      registrationOpen: 'registration_open',
      evaluationOpen: 'evaluation_open',
      isCurrent: 'is_current',
    });
    if (!sets.length) return;
    try {
      await this.db.transaction(async (client) => {
        if (patch.isCurrent === true) await client.query('UPDATE terms SET is_current = false WHERE is_current AND id <> $1', [id]);
        const r = await client.query(`UPDATE terms SET ${sets.join(', ')} WHERE id = $1`, [id, ...values]);
        if (!r.rowCount) throw notFound('Term');
      });
    } catch (err) {
      if (isUnique(err)) throw dup('That academic year and semester already exists.');
      throw err;
    }
    await this.audit.record(actor, 'term.update', { type: 'term', id }, patch);
  }

  // ---------------------------------------------------------------- offerings

  async listOfferings(termId?: string, courseId?: string) {
    const { rows } = await this.db.query(
      `SELECT o.id, o.capacity, o.unit_id AS "unitId", o.term_id AS "termId", o.lecturer_id AS "lecturerId",
              un.code AS "unitCode", un.name AS "unitName", un.year_of_study AS "yearOfStudy", un.semester,
              c.id AS "courseId", c.name AS "courseName", t.name AS "termName",
              l.display_name AS "lecturerName", l.staff_number AS "staffNumber",
              (SELECT count(*) FROM enrolments e WHERE e.offering_id = o.id AND e.status = 'enrolled') AS enrolled
         FROM offerings o
         JOIN units un ON un.id = o.unit_id
         JOIN courses c ON c.id = un.course_id
         JOIN terms t ON t.id = o.term_id
         LEFT JOIN users l ON l.id = o.lecturer_id
        WHERE ($1::uuid IS NULL OR o.term_id = $1::uuid) AND ($2::uuid IS NULL OR un.course_id = $2::uuid)
        ORDER BY c.name, un.year_of_study, un.semester, un.code`,
      [termId ?? null, courseId ?? null],
    );
    return rows;
  }

  async createOffering(actor: AuthUser, dto: OfferingDto) {
    if (dto.lecturerId) await this.assertLecturer(dto.lecturerId);
    try {
      const { rows } = await this.db.query<{ id: string }>(
        `INSERT INTO offerings (unit_id, term_id, lecturer_id, capacity) VALUES ($1,$2,$3,$4) RETURNING id`,
        [dto.unitId, dto.termId, dto.lecturerId, dto.capacity],
      );
      await this.audit.record(actor, 'offering.create', { type: 'offering', id: rows[0].id });
      return { id: rows[0].id };
    } catch (err) {
      if (isUnique(err)) throw dup('This unit is already scheduled for that term.');
      if (isFk(err)) throw notFound('Unit or term');
      throw err;
    }
  }

  async updateOffering(actor: AuthUser, id: string, patch: Patch) {
    if (typeof patch.lecturerId === 'string') await this.assertLecturer(patch.lecturerId);
    const { sets, values } = buildSet(patch, { lecturerId: 'lecturer_id', capacity: 'capacity' });
    if (!sets.length) return;
    const r = await this.db.query(`UPDATE offerings SET ${sets.join(', ')} WHERE id = $1`, [id, ...values]);
    if (!r.rowCount) throw notFound('Class');
    await this.audit.record(actor, 'offering.update', { type: 'offering', id }, patch);
  }

  async deleteOffering(actor: AuthUser, id: string) {
    const used = await this.db.query('SELECT 1 FROM enrolments WHERE offering_id = $1 LIMIT 1', [id]);
    if (used.rowCount) {
      throw new ConflictException({ code: 'IN_USE', message: 'Students are registered in this class. Remove them first.' });
    }
    const r = await this.db.query('DELETE FROM offerings WHERE id = $1', [id]);
    if (!r.rowCount) throw notFound('Class');
    await this.audit.record(actor, 'offering.delete', { type: 'offering', id });
  }

  private async assertLecturer(userId: string) {
    const { rowCount } = await this.db.query(`SELECT 1 FROM users WHERE id = $1 AND role = 'lecturer' AND status = 'active'`, [userId]);
    if (!rowCount) throw new ConflictException({ code: 'NOT_A_LECTURER', message: 'Choose an active lecturer account.' });
  }
}
