import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLogger } from '@invoiceguard/shared/logger';
import { createMailer } from './mailer';

describe('file mailer', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  });

  it('writes one RFC 822 message per send under a relative dir resolved against baseDir', async () => {
    dir = await mkdtemp(join(tmpdir(), 'ig-mail-'));
    const mailer = createMailer(
      {
        EMAIL_TRANSPORT: 'file',
        EMAIL_FILE_DIR: 'mail',
        EMAIL_FROM: 'InvoiceGuard <no-reply@invoiceguard.test>',
      },
      { baseDir: dir, logger: createLogger({ name: 'test', level: 'silent' }) },
    );
    await mailer.send({
      to: 'ann@example.test',
      subject: 'Hello',
      text: 'Link: http://localhost:3000/x#token=abc',
      html: '<p>Hello</p>',
    });
    const files = await readdir(join(dir, 'mail'));
    expect(files).toHaveLength(1);
    const raw = await readFile(join(dir, 'mail', files[0] ?? ''), 'utf8');
    expect(raw).toContain('To: ann@example.test');
    expect(raw).toContain('Subject: Hello');
    expect(raw).toContain('From: InvoiceGuard <no-reply@invoiceguard.test>');
    expect(raw).toContain('http://localhost:3000/x#token=abc');
  });
});
