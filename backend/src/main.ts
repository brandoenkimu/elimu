import 'dotenv/config';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './chat/redis-io.adapter';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { APP_CONFIG, AppConfig } from './config/app-config';
import { RealtimeBus } from './realtime/realtime.bus';

async function bootstrap(): Promise<void> {
  const log = new Logger('Bootstrap');

  // bodyParser is turned off so we can install our own with a small size limit.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const cfg = app.get<AppConfig>(APP_CONFIG);

  app.disable('x-powered-by');
  app.set('trust proxy', cfg.TRUST_PROXY);

  // This API only returns JSON, so a locked-down CSP is safe and removes a whole class of surprises.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      referrerPolicy: { policy: 'no-referrer' },
      // The browser app lives on another origin; CORS (below) is what restricts who may read responses.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  // JSON bodies stay tiny; file uploads arrive as raw bytes on their own content type, capped at 10 MB.
  app.useBodyParser('json', { limit: '64kb' });
  app.useBodyParser('raw', { type: 'application/octet-stream', limit: '10mb' });
  app.use(cookieParser());

  const allowedOrigins = new Set(cfg.CORS_ORIGINS);
  app.enableCors({
    origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-File-Name'],
    exposedHeaders: ['Content-Disposition'],
    maxAge: 600,
  });

  app.setGlobalPrefix('api');
  app.useGlobalFilters(new AllExceptionsFilter());

  const redisAdapter = new RedisIoAdapter(app, cfg, app.get(RealtimeBus));
  await redisAdapter.connect();
  app.useWebSocketAdapter(redisAdapter);

  app.enableShutdownHooks();
  await app.listen(cfg.PORT, cfg.HOST);
  log.log(`${cfg.NODE_ID} listening on http://${cfg.HOST}:${cfg.PORT} (API at /api, Socket.IO at /socket.io)`);
}

process.on('unhandledRejection', (reason) => {
  // Logged, not fatal: a failed Redis publish during an outage must not take the node down.
  new Logger('Process').error(`Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
});
process.on('uncaughtException', (err) => {
  new Logger('Process').error(`Uncaught exception: ${err.stack ?? err.message}`);
  process.exit(1);
});

bootstrap().catch((err: Error) => {
  new Logger('Bootstrap').error(err.message);
  process.exit(1);
});
