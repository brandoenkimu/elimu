import {
  CanActivate,
  ExecutionContext,
  Global,
  HttpException,
  HttpStatus,
  Injectable,
  Module,
  ServiceUnavailableException,
  SetMetadata,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { RateLimitService } from './rate-limit.service';

export interface RateLimitOptions {
  bucket: string;
  limit: number;
  windowSec: number;
  /** Deny requests when Redis is unreachable. Use for login and registration. */
  failClosed?: boolean;
}

const RATE_LIMIT_KEY = 'campusconnect:rate-limit';
const SKIP_RATE_LIMIT_KEY = 'campusconnect:skip-rate-limit';

export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);
export const SkipRateLimit = () => SetMetadata(SKIP_RATE_LIMIT_KEY, true);

const DEFAULT_LIMIT: RateLimitOptions = { bucket: 'api', limit: 300, windowSec: 60 };

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT_KEY, targets)) return true;
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, targets) ?? DEFAULT_LIMIT;

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const result = await this.limiter.consume(
      options.bucket,
      RateLimitService.fingerprint(req.ip ?? 'unknown'),
      options.limit,
      options.windowSec,
      options.failClosed ?? false,
    );

    if (result.unavailable && options.failClosed) {
      throw new ServiceUnavailableException({
        code: 'SERVICE_UNAVAILABLE',
        message: 'This service is temporarily unavailable. Please try again shortly.',
      });
    }
    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfterSec));
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: `Too many requests. Try again in ${result.retryAfterSec} seconds.`,
          retryAfterSec: result.retryAfterSec,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}

@Global()
@Module({
  providers: [RateLimitService, { provide: APP_GUARD, useClass: RateLimitGuard }],
  exports: [RateLimitService],
})
export class RateLimitModule {}
