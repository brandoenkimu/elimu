import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';

const DEFAULT_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

/**
 * One response shape for every error: { statusCode, code, message, ... }.
 * Unexpected errors are logged on the server and reported to the client as a
 * generic 500 so internals (SQL, stack traces, file paths) never leak.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      const body = typeof raw === 'string' ? { message: raw } : (raw as Record<string, unknown>);
      res.status(status).json({
        statusCode: status,
        code: typeof body.code === 'string' ? body.code : (DEFAULT_CODES[status] ?? 'ERROR'),
        message: typeof body.message === 'string' ? body.message : 'Request failed.',
        ...(body.issues ? { issues: body.issues } : {}),
        ...(typeof body.retryAfterSec === 'number' ? { retryAfterSec: body.retryAfterSec } : {}),
      });
      return;
    }

    // Errors raised by Express middleware (body-parser: malformed JSON, body too large).
    const maybeStatus = (exception as { status?: unknown; statusCode?: unknown } | null) ?? {};
    const clientStatus = [maybeStatus.status, maybeStatus.statusCode].find(
      (s): s is number => typeof s === 'number' && s >= 400 && s < 500,
    );
    if (clientStatus) {
      res.status(clientStatus).json({
        statusCode: clientStatus,
        code: DEFAULT_CODES[clientStatus] ?? 'BAD_REQUEST',
        message: clientStatus === 413 ? 'Request body is too large.' : 'The request could not be processed.',
      });
      return;
    }

    this.log.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    res.status(500).json({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on our side. Please try again.',
    });
  }
}
