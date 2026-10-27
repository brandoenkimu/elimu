import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthUser, Role } from './types';

const ROLES_KEY = 'campusconnect:roles';
const ALLOW_PW_CHANGE_KEY = 'campusconnect:allow-password-change';

/** Restrict a route (or controller) to these roles. Use together with AuthGuard. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Routes a user may call while they are still required to choose a new password. */
export const AllowWhenPasswordChangeRequired = () => SetMetadata(ALLOW_PW_CHANGE_KEY, true);
export { ALLOW_PW_CHANGE_KEY };

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) return true;
    const user = (context.switchToHttp().getRequest<Request & { user?: AuthUser }>()).user;
    if (!user || !roles.includes(user.role)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have access to this area.' });
    }
    return true;
  }
}
