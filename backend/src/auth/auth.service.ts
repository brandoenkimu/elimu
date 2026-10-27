import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { hashPassword, verifyPassword } from '../common/password';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DatabaseService } from '../database/database.service';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { MailService } from '../shared/mail.service';
import { NotificationsService } from '../shared/notifications.service';
import { SelfUser, UserRow, UsersRepository, toSelfUser } from '../users/users.repository';
import type { ChangePasswordDto, LoginDto, RegisterDto, ResetDto } from './auth.dto';
import { TokenService } from './token.service';

export interface Session {
  accessToken: string;
  expiresInSec: number;
  refreshToken: string;
  refreshExpiresAt: Date;
  /** False for "don't remember me": the cookie then lasts only until the browser closes. */
  persistent: boolean;
  user: SelfUser;
}

/**
 * A second use of a just-rotated refresh token inside this window is treated as
 * a harmless race (two tabs refreshing together), not as theft.
 */
const ROTATION_GRACE_MS = 10_000;
const RESET_TTL_MIN = 30;
const NON_PERSISTENT_TTL_MS = 24 * 60 * 60 * 1000;

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const fieldError = (field: string, message: string) =>
  new BadRequestException({
    code: 'VALIDATION_FAILED',
    message: 'Some of the information you entered is not valid.',
    issues: [{ field, message }],
  });

@Injectable()
export class AuthService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Auth');
  private dummyHash = '';
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly db: DatabaseService,
    private readonly users: UsersRepository,
    private readonly tokens: TokenService,
    private readonly limiter: RateLimitService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Verifying against this hash when an email is unknown keeps response time
    // the same for "no such user" and "wrong password".
    this.dummyHash = await hashPassword(randomBytes(16).toString('hex'));

    this.cleanupTimer = setInterval(() => {
      this.db
        .query(`DELETE FROM refresh_tokens WHERE expires_at < now() - interval '1 day'`)
        .then(() => this.db.query(`DELETE FROM password_resets WHERE expires_at < now() - interval '1 day'`))
        .catch((err: Error) => this.log.warn(`Token cleanup failed: ${err.message}`));
    }, 60 * 60 * 1000);
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  // ------------------------------------------------------------------ sign up

  async register(dto: RegisterDto): Promise<{ session: Session } | { pending: true }> {
    if (this.cfg.ALLOWED_EMAIL_DOMAINS.length > 0) {
      const domain = dto.email.split('@')[1] ?? '';
      if (!this.cfg.ALLOWED_EMAIL_DOMAINS.includes(domain)) {
        throw new ForbiddenException({
          code: 'EMAIL_DOMAIN_NOT_ALLOWED',
          message: 'Please sign up with your university email address.',
        });
      }
    }

    let courseId: string | null = null;
    let yearOfStudy: number | null = null;
    if (dto.role === 'student' && dto.courseId) {
      const { rows } = await this.db.query<{ duration_years: number }>(
        'SELECT duration_years FROM courses WHERE id = $1 AND active',
        [dto.courseId],
      );
      if (!rows[0]) throw fieldError('courseId', 'Choose one of the listed programmes.');
      if (dto.yearOfStudy && dto.yearOfStudy > rows[0].duration_years) {
        throw fieldError('yearOfStudy', `This programme runs for ${rows[0].duration_years} year(s).`);
      }
      courseId = dto.courseId;
      yearOfStudy = dto.yearOfStudy ?? 1;
    }

    const passwordHash = await hashPassword(dto.password);
    let user: UserRow;
    try {
      user = await this.users.create({
        email: dto.email,
        displayName: dto.displayName,
        passwordHash,
        role: dto.role,
        // Lecturers get access only after an administrator approves them.
        status: dto.role === 'lecturer' ? 'pending' : 'active',
        regNumber: dto.role === 'student' ? dto.regNumber : null,
        staffNumber: dto.role === 'lecturer' ? dto.staffNumber : null,
        courseId,
        yearOfStudy,
        department: dto.role === 'lecturer' ? dto.department : null,
        title: dto.role === 'lecturer' ? (dto.title ?? null) : null,
      });
    } catch (err) {
      const e = err as { code?: string; constraint?: string };
      if (e.code === '23505') {
        if (e.constraint === 'users_reg_number_key') {
          throw new ConflictException({
            code: 'REG_NUMBER_TAKEN',
            message: 'That registration number is already in use. Contact your administrator if this is a mistake.',
          });
        }
        if (e.constraint === 'users_staff_number_key') {
          throw new ConflictException({
            code: 'STAFF_NUMBER_TAKEN',
            message: 'That staff number is already in use. Contact your administrator if this is a mistake.',
          });
        }
        throw new ConflictException({
          code: 'EMAIL_TAKEN',
          message: 'An account with this email already exists. Try signing in instead.',
        });
      }
      throw err;
    }

    if (user.status === 'pending') {
      void this.notifications.notifyRole('admin', {
        type: 'lecturer_pending',
        title: 'Lecturer account awaiting approval',
        body: `${user.display_name} (${user.department ?? 'no department'}) has registered.`,
        data: { link: '/app/admin/approvals' },
      });
      return { pending: true };
    }

    const full = (await this.users.findById(user.id)) ?? user;
    return { session: await this.db.transaction((client) => this.issueSession(client, full, randomUUID(), true)) };
  }

  // ------------------------------------------------------------------ sign in

  async login(dto: LoginDto, ip: string): Promise<Session> {
    // Per-account limit, keyed by email + IP so one attacker cannot lock a victim out
    // from everywhere. Fails closed: if Redis is down we refuse rather than allow guessing.
    const attempt = await this.limiter.consume(
      'login-account',
      RateLimitService.fingerprint(dto.email, ip),
      5,
      15 * 60,
      true,
    );
    if (attempt.unavailable) {
      throw new ServiceUnavailableException({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Sign-in is temporarily unavailable. Please try again shortly.',
      });
    }
    if (!attempt.allowed) {
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: `Too many sign-in attempts. Try again in ${Math.ceil(attempt.retryAfterSec / 60)} minute(s).`,
          retryAfterSec: attempt.retryAfterSec,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const found = await this.users.findByEmail(dto.email);
    const valid = await verifyPassword(found?.password_hash ?? this.dummyHash, dto.password);
    if (!found || !valid) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect.',
      });
    }
    // Status is revealed only after the password is proven, so it cannot be used to probe for accounts.
    if (found.status === 'pending') {
      throw new ForbiddenException({
        code: 'ACCOUNT_PENDING',
        message: 'Your account is waiting for administrator approval. You will be able to sign in once it is approved.',
      });
    }
    if (found.status === 'suspended') {
      throw new ForbiddenException({
        code: 'ACCOUNT_SUSPENDED',
        message: 'This account has been suspended. Contact your administrator.',
      });
    }

    await this.db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [found.id]);
    const user = (await this.users.findById(found.id)) ?? found;
    return this.db.transaction((client) => this.issueSession(client, user, randomUUID(), dto.remember));
  }

  /**
   * Rotates the refresh token: the presented token is revoked and a new one in
   * the same family is issued. If an already-used token shows up again (outside
   * the short grace window) the whole family is revoked, because it means a copy
   * of the token exists somewhere it should not.
   */
  async refresh(rawToken: string | undefined): Promise<Session> {
    if (!rawToken || rawToken.length > 200) {
      throw new UnauthorizedException({ code: 'NO_REFRESH_TOKEN', message: 'Please sign in again.' });
    }
    const tokenHash = sha256(rawToken);

    const outcome = await this.db.transaction(async (client) => {
      const { rows } = await client.query<{
        id: string;
        user_id: string;
        family_id: string;
        expires_at: Date;
        revoked_at: Date | null;
        replaced_by: string | null;
        persistent: boolean;
      }>(
        `SELECT id, user_id, family_id, expires_at, revoked_at, replaced_by, persistent
           FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
        [tokenHash],
      );
      const stored = rows[0];
      if (!stored) return { kind: 'invalid' as const };

      if (stored.revoked_at) {
        const age = Date.now() - new Date(stored.revoked_at).getTime();
        if (stored.replaced_by && age < ROTATION_GRACE_MS) return { kind: 'race' as const };
        await client.query(
          'UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL',
          [stored.family_id],
        );
        return { kind: 'reused' as const, userId: stored.user_id };
      }
      if (new Date(stored.expires_at).getTime() <= Date.now()) return { kind: 'expired' as const };

      const user = await this.users.findById(stored.user_id);
      if (!user || user.status !== 'active') {
        await client.query(
          'UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL',
          [stored.family_id],
        );
        return { kind: 'invalid' as const };
      }

      const session = await this.issueSession(client, user, stored.family_id, stored.persistent, stored.id);
      return { kind: 'ok' as const, session };
    });

    switch (outcome.kind) {
      case 'ok':
        return outcome.session;
      case 'race':
        throw new UnauthorizedException({
          code: 'REFRESH_RACE',
          message: 'Session is being refreshed. Retry in a moment.',
        });
      case 'reused':
        this.log.warn(`Refresh token reuse detected for user ${outcome.userId}; session family revoked.`);
        throw new UnauthorizedException({ code: 'SESSION_REVOKED', message: 'Please sign in again.' });
      default:
        throw new UnauthorizedException({ code: 'INVALID_REFRESH_TOKEN', message: 'Please sign in again.' });
    }
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken || rawToken.length > 200) return;
    await this.db.query(
      `UPDATE refresh_tokens SET revoked_at = now()
        WHERE revoked_at IS NULL
          AND family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = $1)`,
      [sha256(rawToken)],
    );
  }

  /** Signs the user out of every device. */
  async logoutAll(userId: string): Promise<void> {
    await this.revokeAll(userId);
  }

  async me(userId: string): Promise<SelfUser> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException({ code: 'INVALID_TOKEN', message: 'Please sign in again.' });
    return toSelfUser(user);
  }

  // ------------------------------------------------------------------ passwords

  /**
   * Always answers the same way, whether or not the email has an account, and does its
   * work after answering so response time reveals nothing either.
   */
  forgot(email: string, ip: string): void {
    void this.processForgot(email, ip).catch((err: Error) => this.log.warn(`Password reset request failed: ${err.message}`));
  }

  private async processForgot(email: string, ip: string): Promise<void> {
    const limit = await this.limiter.consume('forgot', RateLimitService.fingerprint(email, ip), 5, 3600);
    if (!limit.allowed) return;

    const user = await this.users.findByEmail(email);
    if (!user || user.status !== 'active') return;

    const raw = randomBytes(32).toString('base64url');
    await this.db.transaction(async (client) => {
      // Only the newest link works.
      await client.query('UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [user.id]);
      await client.query(
        `INSERT INTO password_resets (user_id, token_hash, expires_at)
         VALUES ($1, $2, now() + make_interval(mins => $3))`,
        [user.id, sha256(raw), RESET_TTL_MIN],
      );
    });

    const link = `${this.cfg.APP_URL}/reset-password?token=${raw}`;
    await this.mail.send({
      to: user.email,
      subject: 'Reset your Elimu password',
      text:
        `Hello ${user.display_name},\n\n` +
        `We received a request to reset your Elimu password. Open this link within ${RESET_TTL_MIN} minutes:\n\n${link}\n\n` +
        `If you did not ask for this, you can ignore this email. Your password will not change.`,
      html:
        `<p>Hello ${escapeHtml(user.display_name)},</p>` +
        `<p>We received a request to reset your Elimu password. This link works for ${RESET_TTL_MIN} minutes:</p>` +
        `<p><a href="${link}">Choose a new password</a></p>` +
        `<p>If you did not ask for this, you can ignore this email. Your password will not change.</p>`,
    });
  }

  async reset(dto: ResetDto): Promise<void> {
    const passwordHash = await hashPassword(dto.password);
    await this.db.transaction(async (client) => {
      const { rows } = await client.query<{ id: string; user_id: string }>(
        `SELECT id, user_id FROM password_resets
          WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`,
        [sha256(dto.token)],
      );
      const found = rows[0];
      if (!found) {
        throw new BadRequestException({
          code: 'INVALID_RESET_TOKEN',
          message: 'This reset link is invalid or has expired. Request a new one.',
        });
      }
      await client.query('UPDATE users SET password_hash = $2, must_change_password = false WHERE id = $1', [
        found.user_id,
        passwordHash,
      ]);
      await client.query('UPDATE password_resets SET used_at = now() WHERE id = $1', [found.id]);
      // Anyone holding an old session loses it.
      await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [
        found.user_id,
      ]);
    });
  }

  /** Changes the password, signs out every other device, and returns a fresh session for this one. */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<Session> {
    const attempt = await this.limiter.consume('change-password', userId, 5, 15 * 60, true);
    if (!attempt.allowed) {
      throw new HttpException(
        { code: 'RATE_LIMITED', message: 'Too many attempts. Try again in a few minutes.', retryAfterSec: attempt.retryAfterSec },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException({ code: 'INVALID_TOKEN', message: 'Please sign in again.' });
    if (!(await verifyPassword(user.password_hash, dto.currentPassword))) {
      throw fieldError('currentPassword', 'Your current password is incorrect.');
    }
    if (dto.newPassword === dto.currentPassword) {
      throw fieldError('newPassword', 'Choose a password different from your current one.');
    }

    const passwordHash = await hashPassword(dto.newPassword);
    return this.db.transaction(async (client) => {
      await client.query('UPDATE users SET password_hash = $2, must_change_password = false WHERE id = $1', [
        userId,
        passwordHash,
      ]);
      await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
      const fresh = (await this.users.findById(userId)) ?? user;
      return this.issueSession(client, fresh, randomUUID(), true);
    });
  }

  async revokeAll(userId: string): Promise<void> {
    await this.db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
  }

  // ------------------------------------------------------------------ internals

  private async issueSession(
    client: PoolClient,
    user: UserRow,
    familyId: string,
    persistent: boolean,
    replacesTokenId?: string,
  ): Promise<Session> {
    const rawToken = randomBytes(32).toString('base64url');
    const newId = randomUUID();
    const lifetimeMs = persistent ? this.cfg.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000 : NON_PERSISTENT_TTL_MS;
    const expiresAt = new Date(Date.now() + lifetimeMs);

    await client.query(
      `INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, expires_at, persistent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [newId, user.id, familyId, sha256(rawToken), expiresAt, persistent],
    );
    if (replacesTokenId) {
      await client.query('UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2 WHERE id = $1', [
        replacesTokenId,
        newId,
      ]);
    }

    return {
      accessToken: await this.tokens.sign(user.id),
      expiresInSec: this.cfg.ACCESS_TOKEN_TTL_SEC,
      refreshToken: rawToken,
      refreshExpiresAt: expiresAt,
      persistent,
      user: toSelfUser(user),
    };
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
