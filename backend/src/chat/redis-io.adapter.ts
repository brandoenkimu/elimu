import type { IncomingMessage } from 'node:http';
import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';
import type { AppConfig } from '../config/app-config';
import type { RealtimeBus } from '../realtime/realtime.bus';

/**
 * Socket.IO adapter that fans every broadcast out through Redis, so a message
 * emitted on NODE_A reaches clients connected to NODE_B and NODE_C.
 *
 * Also applies the transport-level security settings: allowed origins, payload
 * size cap and ping timings.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly log = new Logger('RedisAdapter');
  private pub!: Redis;
  private sub!: Redis;

  constructor(
    app: INestApplicationContext,
    private readonly cfg: AppConfig,
    private readonly bus: RealtimeBus,
  ) {
    super(app);
  }

  /** Connects both Redis clients. Rejects (so startup fails loudly) if Redis is unreachable. */
  async connect(): Promise<void> {
    const options = { connectionName: `campusconnect-adapter-${this.cfg.NODE_ID}`, connectTimeout: 3_000 };
    // Publishing must fail fast while Redis is down; subscribing keeps the default queue
    // so ioredis can re-subscribe automatically after a reconnect.
    this.pub = new Redis(this.cfg.REDIS_URL, {
      ...options,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: (n) => Math.min(n * 250, 3_000),
    });
    this.sub = new Redis(this.cfg.REDIS_URL, {
      ...options,
      retryStrategy: (n) => Math.min(n * 250, 3_000),
    });

    let lastLog = 0;
    const onError = (err: Error) => {
      const now = Date.now();
      if (now - lastLog > 10_000) {
        lastLog = now;
        this.log.warn(`Redis connection problem: ${err.message}`);
      }
    };
    this.pub.on('error', onError);
    this.sub.on('error', onError);

    // The adapter is only "healthy" when both directions work.
    const refresh = () => this.bus.setRedisReady(this.pub.status === 'ready' && this.sub.status === 'ready');
    for (const client of [this.pub, this.sub]) {
      for (const event of ['ready', 'close', 'end']) client.on(event, refresh);
    }

    await Promise.all(
      [this.pub, this.sub].map(
        (client) =>
          new Promise<void>((resolve, reject) => {
            if (client.status === 'ready') return resolve();
            const timer = setTimeout(
              () => reject(new Error(`Could not reach Redis at startup (${this.cfg.REDIS_URL})`)),
              5_000,
            );
            client.once('ready', () => {
              clearTimeout(timer);
              resolve();
            });
          }),
      ),
    );
    refresh();
    this.log.log('Redis adapter ready');
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const allowed = new Set(this.cfg.CORS_ORIGINS);
    const server: Server = super.createIOServer(port, {
      ...options,
      cors: { origin: [...allowed], credentials: true },
      // Browsers do not apply CORS to WebSocket upgrades, so check Origin ourselves.
      // Non-browser clients (tests, curl) send no Origin and are authenticated by token alone.
      allowRequest: (req: IncomingMessage, callback: (err: string | null | undefined, success: boolean) => void) => {
        const origin = req.headers.origin;
        callback(null, !origin || allowed.has(origin));
      },
      maxHttpBufferSize: 16 * 1024, // 16 KB: a 2,000-character message is far below this
      pingInterval: 10_000,
      pingTimeout: 8_000,
      connectTimeout: 10_000,
    } as ServerOptions);

    server.adapter(createAdapter(this.pub, this.sub, { requestsTimeout: 3_000 }));
    return server;
  }

  override async dispose(): Promise<void> {
    await super.dispose();
    await Promise.allSettled([this.pub?.quit(), this.sub?.quit()]);
  }
}
