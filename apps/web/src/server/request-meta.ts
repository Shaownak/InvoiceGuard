import { isIP } from 'node:net';
import type { RequestMeta } from './services';

/**
 * Client IP and user agent for the audit log. X-Forwarded-For is client-controlled unless a
 * trusted proxy overwrites it, so it is used only when TRUST_PROXY_HEADERS is set, and only
 * if the first entry is a valid IP (the column is `inet`).
 */
export function requestMeta(headers: Headers, trustProxyHeaders: boolean): RequestMeta {
  let ip: string | null = null;
  if (trustProxyHeaders) {
    const first = headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
    ip = isIP(first) === 0 ? null : first;
  }
  const userAgent = headers.get('user-agent');
  return { ip, userAgent: userAgent === null ? null : userAgent.slice(0, 512) };
}

/**
 * CSRF defence for cookie-authenticated mutations (ARCHITECTURE.md section 13): the Origin
 * header must match APP_URL. Browsers send Origin on every cross-origin request and on
 * same-origin POSTs; without one, `Sec-Fetch-Site: same-origin` is accepted as proof. A
 * request carrying neither is refused, so a forged form post or fetch from another site
 * cannot act with the victim's session, whatever the cookie's SameSite handling.
 */
export function isSameOrigin(headers: Headers, appUrl: string): boolean {
  const origin = headers.get('origin');
  if (origin !== null) return origin === new URL(appUrl).origin;
  return headers.get('sec-fetch-site') === 'same-origin';
}
