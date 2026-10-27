import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ALLOW_PW_CHANGE_KEY } from '../common/roles';
import type { AuthUser } from '../common/types';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { UsersRepository } from '../users/users.repository';
import { TokenService } from './token.service';

export interface AuthedRequest extends Request {
  user: AuthUser;
}

/**
 * Verifies the bearer token, then loads the user fresh from the database, so a
 * suspension or role change takes effect on the very next request rather than
 * when the token expires.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly users: UsersRepository,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ') || header.length > 2100) {
      throw new UnauthorizedException({ code: 'NO_TOKEN', message: 'Please sign in to continue.' });
    }

    let subject: string;
    try {
      subject = (await this.tokens.verify(header.slice(7))).sub;
    } catch (err) {
      const expired = (err as Error).name === 'TokenExpiredError';
      throw new UnauthorizedException({
        code: expired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
        message: expired ? 'Your session expired.' : 'Please sign in again.',
      });
    }

    const user = await this.users.findById(subject);
    if (!user) throw new UnauthorizedException({ code: 'INVALID_TOKEN', message: 'Please sign in again.' });
    if (user.status === 'suspended') {
      throw new ForbiddenException({ code: 'ACCOUNT_SUSPENDED', message: 'This account has been suspended. Contact your administrator.' });
    }
    if (user.status === 'pending') {
      throw new ForbiddenException({ code: 'ACCOUNT_PENDING', message: 'This account is waiting for administrator approval.' });
    }
    if (user.must_change_password) {
      const allowed = this.reflector.getAllAndOverride<boolean | undefined>(ALLOW_PW_CHANGE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!allowed) {
        throw new ForbiddenException({ code: 'PASSWORD_CHANGE_REQUIRED', message: 'Please choose a new password to continue.' });
      }
    }

    req.user = {
      id: user.id,
      role: user.role,
      status: user.status,
      displayName: user.display_name,
      mustChangePassword: user.must_change_password,
    };
    return true;
  }
}

/**
 * Cookie-authenticated endpoints (refresh, logout) cannot rely on a bearer
 * header, so they additionally require any browser-supplied Origin to be on
 * the allow-list. Together with SameSite cookies this blocks cross-site forgery.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const origin = context.switchToHttp().getRequest<Request>().headers.origin;
    if (origin && !this.cfg.CORS_ORIGINS.includes(origin)) {
      throw new ForbiddenException({ code: 'BAD_ORIGIN', message: 'Request origin is not allowed.' });
    }
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => context.switchToHttp().getRequest<AuthedRequest>().user,
);
