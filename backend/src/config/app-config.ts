import { Global, Module } from '@nestjs/common';
import { z } from 'zod';

export const APP_CONFIG = Symbol('APP_CONFIG');

export interface AppConfig {
  NODE_ENV: 'development' | 'production' | 'test';
  NODE_ID: string;
  HOST: string;
  PORT: number;
  DATABASE_URL: string;
  REDIS_URL: string;
  JWT_ACCESS_SECRET: string;
  ACCESS_TOKEN_TTL_SEC: number;
  REFRESH_TOKEN_TTL_DAYS: number;
  CORS_ORIGINS: string[];
  COOKIE_SAMESITE: 'lax' | 'strict' | 'none';
  cookieSecure: boolean;
  TRUST_PROXY: number;
  ALLOWED_EMAIL_DOMAINS: string[];
  DB_POOL_MAX: number;
  /** Public address of the web app, used in links inside emails. */
  APP_URL: string;
  SMTP: { host: string; port: number; user: string; pass: string; from: string; secure: boolean } | null;
}

const csv = (value: string): string[] =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    NODE_ID: z
      .string()
      .regex(/^[A-Z0-9_]{1,16}$/, 'use A-Z, 0-9 and _ only (max 16 characters)')
      .default('NODE_A'),
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    DATABASE_URL: z.string().min(1, 'is required'),
    REDIS_URL: z.string().min(1, 'is required'),
    JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
    ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
    CORS_ORIGINS: z.string().default('http://localhost:5173'),
    COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
    COOKIE_SECURE: z.enum(['true', 'false']).optional(),
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
    ALLOWED_EMAIL_DOMAINS: z.string().optional(),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
    APP_URL: z.string().url().optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_FROM: z.string().default('Elimu <no-reply@localhost>'),
    SMTP_SECURE: z.enum(['true', 'false']).default('false'),
  })
  .superRefine((env, ctx) => {
    if (
      env.NODE_ENV === 'production' &&
      /change[-_ ]?me|your[-_ ]?secret|password/i.test(env.JWT_ACCESS_SECRET)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_ACCESS_SECRET'],
        message: 'looks like a placeholder; generate a random value',
      });
    }
    const secure = env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : env.NODE_ENV === 'production';
    if (env.COOKIE_SAMESITE === 'none' && !secure) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SAMESITE'],
        message: 'SameSite=None requires secure cookies (COOKIE_SECURE=true)',
      });
    }
  });

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
    throw new Error(
      `Invalid environment configuration:\n${lines.join('\n')}\n\n` +
        'Copy backend/.env.example to backend/.env and fill in the missing values.',
    );
  }
  const env = parsed.data;
  return {
    NODE_ENV: env.NODE_ENV,
    NODE_ID: env.NODE_ID,
    HOST: env.HOST,
    PORT: env.PORT,
    DATABASE_URL: env.DATABASE_URL,
    REDIS_URL: env.REDIS_URL,
    JWT_ACCESS_SECRET: env.JWT_ACCESS_SECRET,
    ACCESS_TOKEN_TTL_SEC: env.ACCESS_TOKEN_TTL_SEC,
    REFRESH_TOKEN_TTL_DAYS: env.REFRESH_TOKEN_TTL_DAYS,
    CORS_ORIGINS: csv(env.CORS_ORIGINS),
    COOKIE_SAMESITE: env.COOKIE_SAMESITE,
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : env.NODE_ENV === 'production',
    TRUST_PROXY: env.TRUST_PROXY,
    ALLOWED_EMAIL_DOMAINS: env.ALLOWED_EMAIL_DOMAINS
      ? csv(env.ALLOWED_EMAIL_DOMAINS).map((d) => d.toLowerCase())
      : [],
    DB_POOL_MAX: env.DB_POOL_MAX,
    APP_URL: (env.APP_URL ?? csv(env.CORS_ORIGINS)[0] ?? 'http://localhost:5173').replace(/\/+$/, ''),
    SMTP: env.SMTP_HOST
      ? {
          host: env.SMTP_HOST,
          port: env.SMTP_PORT,
          user: env.SMTP_USER ?? '',
          pass: env.SMTP_PASS ?? '',
          from: env.SMTP_FROM,
          secure: env.SMTP_SECURE === 'true',
        }
      : null,
  };
}

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig() }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
