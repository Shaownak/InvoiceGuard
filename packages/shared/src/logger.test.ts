import { Writable } from 'node:stream';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { REDACT_PATHS, createLogger } from './logger';

function capture(): { lines: string[]; stream: Writable } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { lines, stream };
}

describe('logger redaction', () => {
  it('redacts sensitive keys at the top level and when nested', () => {
    const { lines, stream } = capture();
    const log = pino({ redact: { paths: REDACT_PATHS, censor: '[redacted]' } }, stream);
    log.info(
      {
        password: 'p1',
        iban: 'DE89370400440532013000',
        vendor: { accountNumber: '12345678', name: 'Acme' },
        req: { headers: { authorization: 'Bearer abc', cookie: 'sid=1' } },
        'set-cookie': 'sid=2',
      },
      'test',
    );
    const out = lines.join('');
    for (const secret of [
      'p1',
      'DE89370400440532013000',
      '12345678',
      'Bearer abc',
      'sid=1',
      'sid=2',
    ]) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('Acme');
    expect(out).toContain('[redacted]');
  });

  it('builds a named logger at the requested level', () => {
    const log = createLogger({ name: 'test', level: 'silent' });
    expect(log.level).toBe('silent');
  });
});
