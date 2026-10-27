import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

export interface RateResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
  /** True when Redis could not be reached and the decision is a fallback. */
  unavailable: boolean;
}

// Atomic fixed-window counter: INCR, set the expiry on first hit, return count + TTL.
const WINDOW_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) ttl = tonumber(ARGV[1]) end
return {count, ttl}
`;

/**
 * Rate limiting shared by all three nodes. Counters live in Redis, so a user
 * cannot multiply their allowance by spreading requests across nodes.
 */
@Injectable()
export class RateLimitService {
  private readonly log = new Logger('RateLimit');
  private lastWarn = 0;

  constructor(private readonly redis: RedisService) {}

  /** Hash user-supplied identifiers (emails, IPs) so keys stay short and safe. */
  static fingerprint(...parts: string[]): string {
    return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
  }

  async consume(
    bucket: string,
    id: string,
    limit: number,
    windowSec: number,
    failClosed = false,
  ): Promise<RateResult> {
    const key = `rl:${bucket}:${id}`;
    try {
      const [count, ttl] = (await this.redis.client.eval(WINDOW_SCRIPT, 1, key, windowSec)) as [number, number];
      return {
        allowed: count <= limit,
        remaining: Math.max(0, limit - count),
        retryAfterSec: Math.max(1, ttl),
        unavailable: false,
      };
    } catch (err) {
      const now = Date.now();
      if (now - this.lastWarn > 10_000) {
        this.lastWarn = now;
        this.log.warn(
          `Redis unavailable for bucket "${bucket}" (${failClosed ? 'denying' : 'allowing'} requests): ${(err as Error).message}`,
        );
      }
      return { allowed: !failClosed, remaining: 0, retryAfterSec: 1, unavailable: true };
    }
  }
}
