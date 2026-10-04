import type { ProvidedContext } from 'vitest';
import { createDatabase, type Database } from '@invoiceguard/db';
import { withPgClient } from '@invoiceguard/db/testing';
import { createLogger } from '@invoiceguard/shared/logger';
import { hashPassword } from './auth/password';
import type { EmailMessage, Mailer } from './email/mailer';
import { unlimited, type RateLimiter } from './rate-limit';
import { createServices, type RequestMeta, type Services } from './services';

/** Test-only wiring for web integration tests. Never imported by application code. */

type TestInfra = ProvidedContext['testInfra'];

export const TEST_SECRET = 'test-session-secret-0123456789abcdef';
export const TEST_APP_URL = 'http://localhost:3000';
export const META: RequestMeta = { ip: null, userAgent: 'vitest' };

export interface CapturingMailer extends Mailer {
  sent: EmailMessage[];
  /** The token from the newest link to `path` sent to `to`; throws if there is none. */
  tokenFrom(to: string, path: string): string;
  countTo(to: string): number;
}

export function capturingMailer(): CapturingMailer {
  const sent: EmailMessage[] = [];
  return {
    sent,
    send(message) {
      sent.push(message);
      return Promise.resolve();
    },
    tokenFrom(to, path) {
      const pattern = new RegExp(`${TEST_APP_URL}${path}#token=([A-Za-z0-9_-]+)`);
      for (const message of [...sent].reverse()) {
        if (message.to.toLowerCase() !== to.toLowerCase()) continue;
        const match = pattern.exec(message.text);
        if (match?.[1] !== undefined) return match[1];
      }
      throw new Error(`no ${path} link sent to ${to}`);
    },
    countTo(to) {
      return sent.filter((m) => m.to.toLowerCase() === to.toLowerCase()).length;
    },
  };
}

export interface TestServices {
  services: Services;
  db: Database;
  mailer: CapturingMailer;
  close(): Promise<void>;
}

export function createTestServices(
  infra: TestInfra,
  options: { limiter?: RateLimiter } = {},
): TestServices {
  const db = createDatabase(infra.postgres.appUrl, { applicationName: 'ig-web-test' });
  const mailer = capturingMailer();
  const services = createServices({
    db,
    mailer,
    limiter: options.limiter ?? unlimited,
    secret: TEST_SECRET,
    appUrl: TEST_APP_URL,
    logger: createLogger({ name: 'test', level: 'silent' }),
  });
  return { services, db, mailer, close: () => db.close() };
}

/** Audit actions recorded for an org, oldest first (read as the owner role). */
export async function auditActions(ownerUrl: string, orgId: string): Promise<string[]> {
  return withPgClient(ownerUrl, async (c) => {
    const res = await c.query<{ action: string }>(
      'SELECT action FROM audit_log WHERE org_id = $1 ORDER BY created_at, id',
      [orgId],
    );
    return res.rows.map((r) => r.action);
  });
}

/** Gives a seeded user a real password, so they can sign in through the API. */
export async function setPassword(
  ownerUrl: string,
  userId: string,
  password: string,
): Promise<void> {
  const hash = await hashPassword(password);
  await withPgClient(ownerUrl, (c) =>
    c.query('UPDATE user_credentials SET password_hash = $2 WHERE user_id = $1', [userId, hash]),
  );
}
