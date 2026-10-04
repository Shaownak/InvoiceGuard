import { argon2, randomBytes, timingSafeEqual, type Argon2Algorithm } from 'node:crypto';
import { z } from 'zod';

/**
 * Password hashing with Node's built-in argon2 (ADR-0007), stored in the PHC string format
 * (`$argon2id$v=19$m=...,t=...,p=...$salt$hash`) used by every argon2 library, so the stored
 * hashes stay portable if the implementation changes.
 */

/** OWASP Password Storage Cheat Sheet minimum for argon2id: 19 MiB, 2 passes, 1 lane. */
const PARAMS = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 } as const;
const SALT_BYTES = 16;
const ARGON2_VERSION = 19;

/** NIST SP 800-63B: length over composition rules; long passphrases welcome. */
export const passwordSchema = z
  .string()
  .min(12, 'Use at least 12 characters')
  .max(128, 'Use at most 128 characters');

export interface Argon2Hash {
  algorithm: Argon2Algorithm;
  memory: number;
  passes: number;
  parallelism: number;
  salt: Buffer;
  hash: Buffer;
}

function b64(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '');
}

export function encodePhc(h: Argon2Hash): string {
  return `$${h.algorithm}$v=${String(ARGON2_VERSION)}$m=${String(h.memory)},t=${String(h.passes)},p=${String(h.parallelism)}$${b64(h.salt)}$${b64(h.hash)}`;
}

const PHC =
  /^\$(argon2id|argon2i|argon2d)\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

export function decodePhc(encoded: string): Argon2Hash | null {
  const m = PHC.exec(encoded);
  if (m === null) return null;
  const [, algorithm, memory, passes, parallelism, salt, hash] = m;
  if (
    algorithm === undefined ||
    memory === undefined ||
    passes === undefined ||
    parallelism === undefined ||
    salt === undefined ||
    hash === undefined
  ) {
    return null;
  }
  return {
    algorithm: z.enum(['argon2id', 'argon2i', 'argon2d']).parse(algorithm),
    memory: Number(memory),
    passes: Number(passes),
    parallelism: Number(parallelism),
    salt: Buffer.from(salt, 'base64'),
    hash: Buffer.from(hash, 'base64'),
  };
}

/** Raw argon2 on the libuv thread pool (does not block the event loop). */
export function argon2Raw(
  algorithm: Argon2Algorithm,
  message: Buffer,
  params: { nonce: Buffer; memory: number; passes: number; parallelism: number; tagLength: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(algorithm, { message, ...params }, (err, derived) => {
      if (err !== null) reject(err);
      else resolve(Buffer.from(derived));
    });
  });
}

/** NFKC so the same passphrase typed on different keyboards hashes the same (SP 800-63B). */
function passwordBytes(password: string): Buffer {
  return Buffer.from(password.normalize('NFKC'), 'utf8');
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await argon2Raw('argon2id', passwordBytes(password), { nonce: salt, ...PARAMS });
  return encodePhc({ algorithm: 'argon2id', ...PARAMS, salt, hash });
}

/** Constant-time comparison. Anything other than a well-formed argon2id hash fails. */
export async function verifyPassword(encoded: string, password: string): Promise<boolean> {
  const parsed = decodePhc(encoded);
  if (parsed?.algorithm !== 'argon2id' || parsed.hash.length < 16) return false;
  const candidate = await argon2Raw('argon2id', passwordBytes(password), {
    nonce: parsed.salt,
    memory: parsed.memory,
    passes: parsed.passes,
    parallelism: parsed.parallelism,
    tagLength: parsed.hash.length,
  });
  return timingSafeEqual(candidate, parsed.hash);
}

let dummyHash: Promise<string> | undefined;

/**
 * Burns the same work as a real check, for sign-ins with an unknown email, so response time
 * does not reveal whether an account exists. Always returns false.
 */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(await dummyHash, password);
  return false;
}
