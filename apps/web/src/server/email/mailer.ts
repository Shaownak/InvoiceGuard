import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { createTransport } from 'nodemailer';
import type { EmailEnv } from '@invoiceguard/shared/env';
import type { Logger } from '@invoiceguard/shared/logger';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: EmailMessage): Promise<void>;
}

/**
 * SMTP (Mailpit locally, a provider in production) or, for native development without a mail
 * server, one .eml file per message in EMAIL_FILE_DIR (ADR-0017). A relative directory
 * resolves against `baseDir` (the workspace root) so web and tests agree on the location.
 */
export function createMailer(
  env: EmailEnv & { EMAIL_FROM: string },
  options: { baseDir: string; logger: Logger },
): Mailer {
  if (env.EMAIL_TRANSPORT === 'smtp') {
    const transport = createTransport(env.SMTP_URL);
    return {
      async send(message) {
        await transport.sendMail({ from: env.EMAIL_FROM, ...message });
      },
    };
  }

  const dir = isAbsolute(env.EMAIL_FILE_DIR)
    ? env.EMAIL_FILE_DIR
    : join(options.baseDir, env.EMAIL_FILE_DIR);
  const transport = createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  return {
    async send(message) {
      const info = await transport.sendMail({ from: env.EMAIL_FROM, ...message });
      const raw: unknown = info.message;
      if (!Buffer.isBuffer(raw)) throw new Error('stream transport returned no buffer');
      await mkdir(dir, { recursive: true });
      // Sortable by time; the random suffix keeps concurrent sends apart.
      const file = join(dir, `${String(Date.now())}-${randomBytes(4).toString('hex')}.eml`);
      await writeFile(file, raw);
      // The path only: the message holds a sign-in link and must not reach logs.
      options.logger.info({ file }, 'email written (EMAIL_TRANSPORT=file)');
    },
  };
}
