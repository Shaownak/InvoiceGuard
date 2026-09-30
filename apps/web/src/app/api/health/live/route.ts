export const dynamic = 'force-dynamic';

/** Liveness: the process is up and serving requests. Deliberately checks no dependencies. */
export function GET(): Response {
  return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
}
