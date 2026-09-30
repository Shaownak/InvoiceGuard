import { toErrorResponse } from '@invoiceguard/shared/errors';
import { dependencyChecks, runHealthChecks } from '@/server/health';
import { getRuntime } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const CHECK_TIMEOUT_MS = 2_000;

/**
 * Readiness: 200 when the database, Redis and object storage all respond, 503 otherwise.
 * Unversioned on purpose (infra probes should not move with API versions); see
 * docs/adr/0008-health-endpoints.md. Liveness lives at /api/health/live.
 */
export async function GET(): Promise<Response> {
  try {
    const runtime = getRuntime();
    const report = await runHealthChecks(dependencyChecks(runtime), {
      timeoutMs: CHECK_TIMEOUT_MS,
      onFailure: (name, err) => {
        runtime.logger.warn(
          { check: name, err: err instanceof Error ? err.message : 'unknown error' },
          'health check failed',
        );
      },
    });
    return Response.json(report, {
      status: report.status === 'ok' ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    const { status, body } = toErrorResponse(err);
    return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
