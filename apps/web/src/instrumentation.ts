/**
 * Next.js calls register() once when the server starts. Validating env here makes a
 * misconfigured deployment fail at boot instead of on the first request.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { loadWebEnv } = await import('@/server/runtime');
  loadWebEnv();
}
