import { apiRoute } from '@/server/api';

/** Ends the current session. Idempotent: without a session it still clears the cookie. */
export const POST = apiRoute({ auth: 'public' }, async ({ session, services }) => {
  if (session !== null) await services.auth.logout(session);
  return { status: 204, clearSession: true };
});
