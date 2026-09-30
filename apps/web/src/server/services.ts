import type { Database } from '@invoiceguard/db';
import type { Logger } from '@invoiceguard/shared/logger';
import type { Role } from '@invoiceguard/shared/permissions';
import { createAuthService, type AuthService } from './auth/service';
import type { Mailer } from './email/mailer';
import { createOrgService, type OrgService } from './orgs/service';
import type { RateLimiter } from './rate-limit';

/** Everything the services need, injected so tests can supply their own. */
export interface ServiceDeps {
  db: Database;
  mailer: Mailer;
  limiter: RateLimiter;
  /** SESSION_SECRET: keys token hashes and email fingerprints. */
  secret: string;
  appUrl: string;
  logger: Logger;
}

/** Client details recorded in the audit log. */
export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

/** The authenticated caller, resolved from the session cookie on every request. */
export interface SessionContext {
  sessionId: string;
  expiresAt: Date;
  user: { id: string; email: string; name: string };
  /** The active organization and the caller's role in it; null until they join or create one. */
  org: { id: string; role: Role } | null;
}

export type OrgSessionContext = SessionContext & { org: NonNullable<SessionContext['org']> };

/** A newly issued session token, to be set as the cookie. */
export interface IssuedSession {
  token: string;
  expiresAt: Date;
  orgId: string | null;
}

export interface Services {
  auth: AuthService;
  orgs: OrgService;
}

export function createServices(deps: ServiceDeps): Services {
  const auth = createAuthService(deps);
  return { auth, orgs: createOrgService(deps, auth) };
}
