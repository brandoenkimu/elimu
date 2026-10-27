import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../common/types';
import { DatabaseService } from '../database/database.service';

export interface OfferingRef {
  id: string;
  lecturer_id: string | null;
  term_id: string;
  unit_id: string;
}

/** Central place for "may this person touch this class?" decisions. */
@Injectable()
export class AccessService {
  constructor(private readonly db: DatabaseService) {}

  async getOffering(offeringId: string): Promise<OfferingRef | null> {
    const { rows } = await this.db.query<OfferingRef>(
      'SELECT id, lecturer_id, term_id, unit_id FROM offerings WHERE id = $1',
      [offeringId],
    );
    return rows[0] ?? null;
  }

  /** Admins, and the lecturer assigned to the offering. */
  async assertTeach(user: AuthUser, offeringId: string): Promise<OfferingRef> {
    const offering = await this.getOffering(offeringId);
    if (!offering) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Class not found.' });
    if (user.role === 'admin' || (user.role === 'lecturer' && offering.lecturer_id === user.id)) return offering;
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not teach this class.' });
  }

  /** Anyone who teaches the offering or is enrolled in it. */
  async assertView(user: AuthUser, offeringId: string): Promise<OfferingRef> {
    const offering = await this.getOffering(offeringId);
    if (!offering) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Class not found.' });
    if (user.role === 'admin') return offering;
    if (user.role === 'lecturer' && offering.lecturer_id === user.id) return offering;
    if (user.role === 'student' && (await this.isEnrolled(user.id, offeringId))) return offering;
    throw new NotFoundException({ code: 'NOT_FOUND', message: 'Class not found.' });
  }

  async assertEnrolled(user: AuthUser, offeringId: string): Promise<OfferingRef> {
    const offering = await this.getOffering(offeringId);
    if (!offering) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Class not found.' });
    if (user.role !== 'student' || !(await this.isEnrolled(user.id, offeringId))) {
      throw new ForbiddenException({ code: 'NOT_ENROLLED', message: 'You are not registered for this unit.' });
    }
    return offering;
  }

  async isEnrolled(studentId: string, offeringId: string): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `SELECT 1 FROM enrolments WHERE offering_id = $1 AND student_id = $2 AND status = 'enrolled'`,
      [offeringId, studentId],
    );
    return !!rowCount;
  }

  async enrolledStudentIds(offeringId: string): Promise<string[]> {
    const { rows } = await this.db.query<{ student_id: string }>(
      `SELECT student_id FROM enrolments WHERE offering_id = $1 AND status = 'enrolled'`,
      [offeringId],
    );
    return rows.map((r) => r.student_id);
  }
}
