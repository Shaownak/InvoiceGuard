import { argon2Sync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  argon2Raw,
  decodePhc,
  encodePhc,
  hashPassword,
  passwordSchema,
  verifyAgainstDummy,
  verifyPassword,
} from './password';

describe('argon2 implementation', () => {
  it('matches the RFC 9106 section 5.3 argon2id test vector', () => {
    // argon2Raw has no secret/associated-data inputs (we do not use them), so the vector is
    // checked against the same Node primitive it wraps.
    const tag = argon2Sync('argon2id', {
      message: Buffer.alloc(32, 1),
      nonce: Buffer.alloc(16, 2),
      secret: Buffer.alloc(8, 3),
      associatedData: Buffer.alloc(12, 4),
      memory: 32,
      passes: 3,
      parallelism: 4,
      tagLength: 32,
    });
    expect(tag.toString('hex')).toBe(
      '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659',
    );
  });

  it('produces the reference CLI hash and PHC string (argon2i "password"/"somesalt")', async () => {
    const hash = await argon2Raw('argon2i', Buffer.from('password'), {
      nonce: Buffer.from('somesalt'),
      memory: 65_536,
      passes: 2,
      parallelism: 4,
      tagLength: 24,
    });
    expect(hash.toString('hex')).toBe('45d7ac72e76f242b20b77b9bf9bf9d5915894e669a24e6c6');
    const phc = encodePhc({
      algorithm: 'argon2i',
      memory: 65_536,
      passes: 2,
      parallelism: 4,
      salt: Buffer.from('somesalt'),
      hash,
    });
    expect(phc).toBe('$argon2i$v=19$m=65536,t=2,p=4$c29tZXNhbHQ$RdescudvJCsgt3ub+b+dWRWJTmaaJObG');
    expect(decodePhc(phc)?.hash).toEqual(hash);
  });
});

describe('hashPassword / verifyPassword', () => {
  it('stores argon2id with OWASP parameters and a random salt', async () => {
    const a = await hashPassword('correct horse battery staple');
    const b = await hashPassword('correct horse battery staple');
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
    expect(a).not.toBe(b);
  });

  it('accepts the right password and rejects others', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(hash, 'correct horse battery stapl')).toBe(false);
    expect(await verifyPassword(hash, '')).toBe(false);
  });

  it('normalizes Unicode so composed and decomposed input match', async () => {
    const hash = await hashPassword('café au lait please');
    expect(await verifyPassword(hash, 'café au lait please')).toBe(true);
  });

  it('rejects malformed hashes and other argon2 variants instead of throwing', async () => {
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
    expect(await verifyPassword('$argon2id$v=19$m=1,t=1,p=1$$', 'x')).toBe(false);
    expect(
      await verifyPassword(
        '$argon2i$v=19$m=65536,t=2,p=4$c29tZXNhbHQ$RdescudvJCsgt3ub+b+dWRWJTmaaJObG',
        'password',
      ),
    ).toBe(false);
  });

  it('dummy verification always fails', async () => {
    expect(await verifyAgainstDummy('anything at all')).toBe(false);
  });
});

describe('passwordSchema', () => {
  it.each([
    ['a'.repeat(11), false],
    ['a'.repeat(12), true],
    ['a'.repeat(128), true],
    ['a'.repeat(129), false],
  ])('%s -> %s', (value, ok) => {
    expect(passwordSchema.safeParse(value).success).toBe(ok);
  });
});
