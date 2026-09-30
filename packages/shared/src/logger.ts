import { pino, type LevelWithSilent, type Logger } from 'pino';

export type { Logger };

/**
 * Keys that must never reach logs (CLAUDE.md rule 5): credentials, session material, bank
 * details, and document text. Censored at the top level and up to two levels of nesting.
 */
const SENSITIVE_KEYS = [
  'password',
  'passwordHash',
  'token',
  'secret',
  'authorization',
  'cookie',
  'set-cookie',
  'accountNumber',
  'iban',
  'bankAccount',
  'documentText',
  'rawText',
] as const;

export const REDACT_PATHS: string[] = SENSITIVE_KEYS.flatMap((key) => [
  `["${key}"]`,
  `*["${key}"]`,
  `*.*["${key}"]`,
]);

export interface LoggerOptions {
  name: string;
  level: LevelWithSilent;
  base?: Record<string, unknown>;
}

/** Structured JSON logger with the project-wide redaction list applied. */
export function createLogger(options: LoggerOptions): Logger {
  return pino({
    name: options.name,
    level: options.level,
    base: { service: options.name, ...options.base },
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
