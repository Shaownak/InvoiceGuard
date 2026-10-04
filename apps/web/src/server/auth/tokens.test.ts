import { describe, expect, it } from 'vitest';
import { emailFingerprint, generateToken, hashToken, isWellFormedToken } from './tokens';

const SECRET = 'test-secret-0123456789abcdefghijklmnop';

describe('tokens', () => {
  it('generates 256-bit base64url tokens that pass the shape check', () => {
    const tokens = new Set(Array.from({ length: 100 }, generateToken));
    expect(tokens.size).toBe(100);
    for (const t of tokens) expect(isWellFormedToken(t)).toBe(true);
  });

  it('rejects malformed tokens', () => {
    for (const bad of ['', 'short', `${generateToken()}x`, 'a'.repeat(42) + '!']) {
      expect(isWellFormedToken(bad)).toBe(false);
    }
  });

  it('hashes deterministically per secret', () => {
    const token = generateToken();
    expect(hashToken(SECRET, token)).toEqual(hashToken(SECRET, token));
    expect(hashToken(SECRET, token)).toHaveLength(32);
    expect(hashToken(`${SECRET}x`, token)).not.toEqual(hashToken(SECRET, token));
  });

  it('fingerprints email case- and whitespace-insensitively without revealing it', () => {
    const fp = emailFingerprint(SECRET, ' Alice@Example.com ');
    expect(fp).toBe(emailFingerprint(SECRET, 'alice@example.com'));
    expect(fp).toMatch(/^[0-9a-f]{32}$/);
    expect(fp).not.toContain('alice');
  });
});
