import { describe, expect, it } from 'vitest';
import {
  clearSessionCookie,
  readSessionToken,
  serializeSessionCookie,
  sessionCookieConfig,
} from './cookies';

describe('session cookie', () => {
  const expires = new Date('2026-10-30T12:00:00Z');

  it('is httpOnly, SameSite=Lax, Path=/ over http (local dev)', () => {
    const config = sessionCookieConfig('http://localhost:3000');
    expect(config).toEqual({ name: 'ig_session', secure: false });
    expect(serializeSessionCookie(config, 'tok', expires)).toBe(
      'ig_session=tok; Path=/; HttpOnly; SameSite=Lax; Expires=Fri, 30 Oct 2026 12:00:00 GMT',
    );
  });

  it('is Secure with the __Host- prefix over https', () => {
    const config = sessionCookieConfig('https://app.invoiceguard.example');
    expect(config).toEqual({ name: '__Host-ig_session', secure: true });
    const cookie = serializeSessionCookie(config, 'tok', expires);
    expect(cookie).toContain('; Secure');
    expect(cookie).not.toContain('Domain=');
    expect(clearSessionCookie(config)).toBe(
      '__Host-ig_session=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0',
    );
  });

  it('reads the token from a Cookie header among others', () => {
    const config = sessionCookieConfig('http://localhost:3000');
    expect(readSessionToken(config, 'a=1; ig_session=abc_DEF-1; b=2')).toBe('abc_DEF-1');
    expect(readSessionToken(config, 'ig_session_x=nope')).toBeNull();
    expect(readSessionToken(config, 'ig_session=')).toBeNull();
    expect(readSessionToken(config, null)).toBeNull();
  });
});
