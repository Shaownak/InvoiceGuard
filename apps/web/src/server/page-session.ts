import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getRuntime } from './runtime';
import type { OrgSessionContext, SessionContext } from './services';

/** The session for a server component, from the request cookie; null when signed out. */
export async function getPageSession(): Promise<SessionContext | null> {
  // cookies() first: it marks the page dynamic, so `next build` does not try to prerender
  // it (and validate runtime env) at build time.
  const jar = await cookies();
  const runtime = getRuntime();
  const token = jar.get(runtime.sessionCookie.name)?.value;
  return token === undefined ? null : runtime.services.auth.authenticate(token);
}

export async function requirePageSession(): Promise<SessionContext> {
  const session = await getPageSession();
  if (session === null) redirect('/login');
  return session;
}

/** Pages that work inside an organization send org-less users to the overview. */
export async function requireOrgPageSession(): Promise<OrgSessionContext> {
  const session = await requirePageSession();
  if (session.org === null) redirect('/app');
  return { ...session, org: session.org };
}
