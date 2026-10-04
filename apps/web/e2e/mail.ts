import { readdir, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { findWorkspaceRoot, loadWorkspaceEnvFile } from '@invoiceguard/shared/env-file';

/**
 * Reads emails sent by the app under test (ADR-0017): the Mailpit API when MAILPIT_URL is
 * set (CI, Docker), otherwise the .eml files of EMAIL_TRANSPORT=file (native dev).
 */

loadWorkspaceEnvFile();

const ROOT = findWorkspaceRoot(process.cwd()) ?? process.cwd();

/** Undoes quoted-printable soft line breaks and =XX escapes (enough for our ASCII links). */
function decodeQuotedPrintable(raw: string): string {
  return raw
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

async function messagesFromFiles(to: string): Promise<string[]> {
  const configured = process.env.EMAIL_FILE_DIR ?? '.local/mail';
  const dir = isAbsolute(configured) ? configured : join(ROOT, configured);
  const files = (await readdir(dir).catch(() => []))
    .filter((f) => f.endsWith('.eml'))
    .sort()
    .reverse();
  const out: string[] = [];
  for (const file of files.slice(0, 200)) {
    const text = decodeQuotedPrintable(await readFile(join(dir, file), 'utf8'));
    if (new RegExp(`^To: ${to.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'mi').test(text))
      out.push(text);
  }
  return out;
}

async function messagesFromMailpit(base: string, to: string): Promise<string[]> {
  const search = await fetch(`${base}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
  const { messages } = (await search.json()) as { messages: { ID: string }[] };
  const out: string[] = [];
  for (const { ID } of messages) {
    const message = (await (await fetch(`${base}/api/v1/message/${ID}`)).json()) as {
      Text: string;
    };
    out.push(message.Text);
  }
  return out;
}

/** Waits for the newest email to `to` with a link to `path`; returns that link. */
export async function waitForLink(to: string, path: string, timeoutMs = 15_000): Promise<string> {
  const pattern = new RegExp(`https?://[^\\s"]+${path}#token=[A-Za-z0-9_-]+`);
  const deadline = Date.now() + timeoutMs;
  const mailpit = process.env.MAILPIT_URL;
  for (;;) {
    const messages =
      mailpit === undefined ? await messagesFromFiles(to) : await messagesFromMailpit(mailpit, to);
    for (const message of messages) {
      const match = pattern.exec(message);
      if (match !== null) return match[0];
    }
    if (Date.now() > deadline) throw new Error(`no ${path} email for ${to}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}
