import { createHmac, randomBytes } from 'node:crypto';

/**
 * Opaque bearer tokens for sessions and email links. The cookie or link carries 256 random
 * bits; the database stores only HMAC-SHA256(SESSION_SECRET, token), so a database dump alone
 * cannot be used to sign in or to confirm a guessed token (ADR-0007).
 */

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** Cheap shape check before any hashing or database work. */
export function isWellFormedToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

export function hashToken(secret: string, token: string): Buffer {
  return createHmac('sha256', secret).update(token, 'utf8').digest();
}

/** Keys rate limits and logs by address without storing the address itself. */
export function emailFingerprint(secret: string, email: string): string {
  return createHmac('sha256', secret)
    .update(`email:${email.trim().toLowerCase()}`)
    .digest('hex')
    .slice(0, 32);
}
