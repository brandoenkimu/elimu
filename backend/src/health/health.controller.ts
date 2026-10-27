import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DatabaseService } from '../database/database.service';
import { SkipRateLimit } from '../rate-limit/rate-limit.guard';
import { RealtimeBus } from '../realtime/realtime.bus';
import { RedisService } from '../redis/redis.service';

interface CheckResult {
  ok: boolean;
  ms: number;
}

interface HealthBody {
  status: 'ok' | 'degraded';
  node: string;
  startedAt: string;
  uptimeSec: number;
  connections: number;
  checks: { postgres: CheckResult; redis: CheckResult; redisAdapter: { ok: boolean } };
}

const timed = async (probe: () => Promise<void>, timeoutMs = 1_500): Promise<CheckResult> => {
  const started = performance.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      probe(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      }),
    ]);
    return { ok: true, ms: Math.round(performance.now() - started) };
  } catch {
    return { ok: false, ms: Math.round(performance.now() - started) };
  } finally {
    if (timer) clearTimeout(timer);
  }
};

@Controller('health')
@SkipRateLimit()
export class HealthController {
  private readonly startedAt = new Date();
  private cached?: { at: number; body: HealthBody };

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly bus: RealtimeBus,
  ) {}

  /** Liveness: the process is up. Does not touch dependencies. */
  @Get('live')
  live() {
    return { status: 'ok', node: this.cfg.NODE_ID };
  }

  /**
   * Readiness: can this node actually do its job? Returns 503 when PostgreSQL or
   * Redis is unreachable, so node pickers stop sending new users here.
   * The result is cached for one second so this public endpoint cannot be used
   * to hammer the database.
   */
  @Get()
  async ready(@Res({ passthrough: true }) res: Response): Promise<HealthBody> {
    const now = Date.now();
    if (!this.cached || now - this.cached.at > 1_000) {
      const [postgres, redis] = await Promise.all([
        timed(() => this.db.ping()),
        timed(() => this.redis.ping()),
      ]);
      const redisAdapter = { ok: this.bus.isRedisReady() };
      this.cached = {
        at: now,
        body: {
          status: postgres.ok && redis.ok && redisAdapter.ok ? 'ok' : 'degraded',
          node: this.cfg.NODE_ID,
          startedAt: this.startedAt.toISOString(),
          uptimeSec: Math.round(process.uptime()),
          connections: this.bus.connectionCount(),
          checks: { postgres, redis, redisAdapter },
        },
      };
    }
    res.setHeader('Cache-Control', 'no-store');
    if (this.cached.body.status !== 'ok') res.status(503);
    return { ...this.cached.body, uptimeSec: Math.round(process.uptime()), connections: this.bus.connectionCount() };
  }
}
