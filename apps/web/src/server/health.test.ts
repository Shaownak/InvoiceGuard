import { describe, expect, it, vi } from 'vitest';
import {
  HealthCheckTimeoutError,
  dependencyChecks,
  runHealthChecks,
  type HealthCheck,
  type RedisProbe,
} from './health';

const ok = (name: HealthCheck['name']): HealthCheck => ({ name, run: () => Promise.resolve() });
const failing = (name: HealthCheck['name'], message: string): HealthCheck => ({
  name,
  run: () => Promise.reject(new Error(message)),
});

describe('runHealthChecks', () => {
  it('reports ok when every check passes', async () => {
    const report = await runHealthChecks([ok('database'), ok('redis'), ok('storage')], {
      timeoutMs: 100,
    });
    expect(report.status).toBe('ok');
    expect(report.checks.database?.status).toBe('ok');
    expect(Object.keys(report.checks)).toEqual(['database', 'redis', 'storage']);
  });

  it('reports unavailable and names the failing dependency without leaking the error', async () => {
    const onFailure = vi.fn();
    const report = await runHealthChecks(
      [ok('database'), failing('redis', 'connect ECONNREFUSED 10.0.0.5:6379 password=hunter2')],
      { timeoutMs: 100, onFailure },
    );
    expect(report.status).toBe('unavailable');
    expect(report.checks.redis?.status).toBe('fail');
    expect(report.checks.database?.status).toBe('ok');
    expect(JSON.stringify(report)).not.toContain('hunter2');
    expect(JSON.stringify(report)).not.toContain('ECONNREFUSED');
    expect(onFailure).toHaveBeenCalledWith('redis', expect.any(Error));
  });

  it('fails a check that exceeds the timeout', async () => {
    vi.useFakeTimers();
    try {
      const onFailure = vi.fn();
      const hanging: HealthCheck = { name: 'storage', run: () => new Promise(() => undefined) };
      const pending = runHealthChecks([hanging], { timeoutMs: 2_000, onFailure });
      await vi.advanceTimersByTimeAsync(2_000);
      const report = await pending;
      expect(report.checks.storage?.status).toBe('fail');
      expect(onFailure.mock.calls[0]?.[1]).toBeInstanceOf(HealthCheckTimeoutError);
    } finally {
      vi.useRealTimers();
    }
  });

  it('measures latency with the injected clock', async () => {
    let t = 0;
    const report = await runHealthChecks([ok('database')], {
      timeoutMs: 100,
      clock: () => (t += 7),
    });
    expect(report.checks.database?.latencyMs).toBe(7);
  });
});

describe('dependencyChecks', () => {
  function fakeRedis(
    status: string,
    reply = 'PONG',
  ): RedisProbe & { connect: ReturnType<typeof vi.fn> } {
    return { status, connect: vi.fn(() => Promise.resolve()), ping: () => Promise.resolve(reply) };
  }
  const noop = { ping: () => Promise.resolve() };

  it('connects a lazy redis client before pinging', async () => {
    const redis = fakeRedis('wait');
    const report = await runHealthChecks(
      dependencyChecks({ database: noop, redis, storage: noop }),
      {
        timeoutMs: 100,
      },
    );
    expect(redis.connect).toHaveBeenCalledOnce();
    expect(report.status).toBe('ok');
  });

  it('does not reconnect an already connected client', async () => {
    const redis = fakeRedis('ready');
    await runHealthChecks(dependencyChecks({ database: noop, redis, storage: noop }), {
      timeoutMs: 100,
    });
    expect(redis.connect).not.toHaveBeenCalled();
  });

  it('treats an unexpected PING reply as a failure', async () => {
    const report = await runHealthChecks(
      dependencyChecks({ database: noop, redis: fakeRedis('ready', 'LOADING'), storage: noop }),
      { timeoutMs: 100 },
    );
    expect(report.checks.redis?.status).toBe('fail');
  });
});
