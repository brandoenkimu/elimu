import { Global, Inject, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG, AppConfig } from '../config/app-config';

/**
 * General-purpose Redis connection (rate limiting, health checks).
 * The Socket.IO adapter opens its own publisher/subscriber pair in redis-io.adapter.ts.
 *
 * enableOfflineQueue=false makes commands fail immediately while Redis is down
 * instead of piling up in memory and answering minutes later.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly log = new Logger('Redis');
  private lastErrorLog = 0;
  readonly client: Redis;

  constructor(@Inject(APP_CONFIG) cfg: AppConfig) {
    this.client = new Redis(cfg.REDIS_URL, {
      connectionName: `campusconnect-${cfg.NODE_ID}`,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 3_000,
      retryStrategy: (attempt) => Math.min(attempt * 250, 3_000),
    });
    this.client.on('error', (err) => {
      const now = Date.now();
      if (now - this.lastErrorLog > 10_000) {
        this.lastErrorLog = now;
        this.log.warn(`Connection problem: ${err.message}`);
      }
    });
  }

  async ping(): Promise<void> {
    const reply = await this.client.ping();
    if (reply !== 'PONG') throw new Error('Unexpected PING reply');
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }
}

@Global()
@Module({ providers: [RedisService], exports: [RedisService] })
export class RedisModule {}
