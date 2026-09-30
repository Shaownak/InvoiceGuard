import type { Redis } from 'ioredis';
import { RateLimitedError } from '@invoiceguard/shared/errors';

export interface RateLimiter {
  /** Counts one attempt against `key`; throws RateLimitedError once `limit` is exceeded. */
  hit(key: string, limit: number, windowSeconds: number): Promise<void>;
}

/**
 * Fixed-window counters in Redis, shared by every web instance. Keys must not contain raw
 * email addresses (use `emailFingerprint`). Per-IP limits and lockout policy are M8.
 *
 * Fails open: if Redis is unreachable the attempt is allowed and `onStoreError` is told.
 * Limiting is defence in depth; a Redis outage should not stop everyone signing in.
 */
export function createRateLimiter(
  redis: Redis,
  options: { prefix?: string; onStoreError?: (err: unknown) => void } = {},
): RateLimiter {
  const prefix = options.prefix ?? 'ig:rl';
  return {
    async hit(key, limit, windowSeconds) {
      const fullKey = `${prefix}:${key}`;
      let count: unknown;
      let ttl: unknown;
      try {
        const results = await redis
          .multi()
          .incr(fullKey)
          .expire(fullKey, windowSeconds, 'NX')
          .ttl(fullKey)
          .exec();
        count = results?.[0]?.[1];
        ttl = results?.[2]?.[1];
        if (typeof count !== 'number') throw new Error('unexpected Redis reply');
      } catch (err) {
        options.onStoreError?.(err);
        return;
      }
      if (count > limit) {
        throw new RateLimitedError(typeof ttl === 'number' && ttl > 0 ? ttl : windowSeconds);
      }
    },
  };
}

/** For tests and tools that must not depend on Redis. */
export const unlimited: RateLimiter = { hit: () => Promise.resolve() };

/** Limits in one place: [max attempts, window seconds]. */
export const LIMITS = {
  /** Password sign-in attempts per email address. */
  login: [10, 15 * 60],
  /** Emails sent to one address (verification, reset, magic link, invites). */
  emailSend: [5, 60 * 60],
} as const satisfies Record<string, readonly [number, number]>;
