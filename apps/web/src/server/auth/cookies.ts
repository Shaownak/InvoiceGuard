/**
 * The session cookie (FR-AUTH-2): httpOnly, SameSite=Lax, Path=/. Over HTTPS it is also
 * Secure and uses the `__Host-` prefix, which browsers only accept for Secure, host-only,
 * Path=/ cookies, so a subdomain cannot plant or overwrite it.
 */

export interface SessionCookieConfig {
  name: string;
  secure: boolean;
}

export function sessionCookieConfig(appUrl: string): SessionCookieConfig {
  const secure = new URL(appUrl).protocol === 'https:';
  return { name: secure ? '__Host-ig_session' : 'ig_session', secure };
}

function attributes(config: SessionCookieConfig): string {
  return `Path=/; HttpOnly; SameSite=Lax${config.secure ? '; Secure' : ''}`;
}

export function serializeSessionCookie(
  config: SessionCookieConfig,
  token: string,
  expiresAt: Date,
): string {
  return `${config.name}=${token}; ${attributes(config)}; Expires=${expiresAt.toUTCString()}`;
}

export function clearSessionCookie(config: SessionCookieConfig): string {
  return `${config.name}=; ${attributes(config)}; Max-Age=0`;
}

/** Reads the session token from a Cookie header; null when absent. */
export function readSessionToken(
  config: SessionCookieConfig,
  cookieHeader: string | null,
): string | null {
  if (cookieHeader === null) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === config.name) {
      const value = part.slice(eq + 1).trim();
      return value === '' ? null : value;
    }
  }
  return null;
}
