import { Global, Injectable, Module } from '@nestjs/common';
import type { AccountStatus, Role } from '../common/types';
import { DatabaseService } from '../database/database.service';

export interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  role: Role;
  status: AccountStatus;
  reg_number: string | null;
  staff_number: string | null;
  course_id: string | null;
  year_of_study: number | null;
  department: string | null;
  title: string | null;
  phone: string | null;
  bio: string;
  office: string | null;
  office_hours: string | null;
  preferences: Record<string, unknown>;
  must_change_password: boolean;
  last_login_at: Date | null;
  created_at: Date;
  /** Present when the row came from findById (joined with the user's programme). */
  course_name?: string | null;
  course_code?: string | null;
}

/** Everything the signed-in user may see about themselves. Never includes the password hash. */
export interface SelfUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: AccountStatus;
  mustChangePassword: boolean;
  regNumber: string | null;
  staffNumber: string | null;
  courseId: string | null;
  courseName: string | null;
  courseCode: string | null;
  yearOfStudy: number | null;
  department: string | null;
  title: string | null;
  phone: string | null;
  bio: string;
  office: string | null;
  officeHours: string | null;
  preferences: Record<string, unknown>;
  lastLoginAt: string | null;
  createdAt: string;
}

export const toSelfUser = (row: UserRow): SelfUser => ({
  id: row.id,
  email: row.email,
  displayName: row.display_name,
  role: row.role,
  status: row.status,
  mustChangePassword: row.must_change_password,
  regNumber: row.reg_number,
  staffNumber: row.staff_number,
  courseId: row.course_id,
  courseName: row.course_name ?? null,
  courseCode: row.course_code ?? null,
  yearOfStudy: row.year_of_study,
  department: row.department,
  title: row.title,
  phone: row.phone,
  bio: row.bio,
  office: row.office,
  officeHours: row.office_hours,
  preferences: row.preferences ?? {},
  lastLoginAt: row.last_login_at ? row.last_login_at.toISOString() : null,
  createdAt: row.created_at.toISOString(),
});

export interface NewUser {
  email: string;
  displayName: string;
  passwordHash: string;
  role: Role;
  status?: AccountStatus;
  regNumber?: string | null;
  staffNumber?: string | null;
  courseId?: string | null;
  yearOfStudy?: number | null;
  department?: string | null;
  title?: string | null;
  mustChangePassword?: boolean;
}

@Injectable()
export class UsersRepository {
  constructor(private readonly db: DatabaseService) {}

  async findById(id: string): Promise<UserRow | null> {
    const { rows } = await this.db.query<UserRow>(
      `SELECT u.*, c.name AS course_name, c.code AS course_code
         FROM users u LEFT JOIN courses c ON c.id = u.course_id
        WHERE u.id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async findByEmail(email: string): Promise<UserRow | null> {
    const { rows } = await this.db.query<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
    return rows[0] ?? null;
  }

  /** Throws a pg error with code 23505 (and a constraint name) when email, registration or staff number is taken. */
  async create(input: NewUser): Promise<UserRow> {
    const { rows } = await this.db.query<UserRow>(
      `INSERT INTO users (email, display_name, password_hash, role, status, reg_number, staff_number,
                          course_id, year_of_study, department, title, must_change_password)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        input.email,
        input.displayName,
        input.passwordHash,
        input.role,
        input.status ?? 'active',
        input.regNumber ?? null,
        input.staffNumber ?? null,
        input.courseId ?? null,
        input.yearOfStudy ?? null,
        input.department ?? null,
        input.title ?? null,
        input.mustChangePassword ?? false,
      ],
    );
    return rows[0];
  }
}

@Global()
@Module({ providers: [UsersRepository], exports: [UsersRepository] })
export class UsersModule {}
