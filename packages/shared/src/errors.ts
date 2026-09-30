/**
 * Typed application errors. Code throws these; the API layer maps them to the standard
 * `{ error: { code, message, details } }` shape with `toErrorResponse`.
 */

export const ERROR_CODES = {
  validation_failed: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  config_invalid: 500,
  internal: 500,
  dependency_unavailable: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: unknown;
  /** Whether `message` and `details` are safe to show to the API caller. */
  readonly expose: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    options: { details?: unknown; expose?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.details = options.details;
    this.expose = options.expose ?? ERROR_CODES[code] < 500;
  }

  get httpStatus(): number {
    return ERROR_CODES[this.code];
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super('validation_failed', message, { details });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super('not_found', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to do that') {
    super('forbidden', message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super('conflict', message, { details });
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Please sign in to continue', details?: unknown) {
    super('unauthenticated', message, { details });
  }
}

export class RateLimitedError extends AppError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('rate_limited', 'Too many attempts. Please wait and try again.', {
      details: { retryAfterSeconds },
    });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ConfigError extends AppError {
  constructor(message: string, details?: unknown) {
    super('config_invalid', message, { details, expose: false });
  }
}

export class DependencyUnavailableError extends AppError {
  constructor(dependency: string, cause?: unknown) {
    super('dependency_unavailable', `${dependency} is unavailable`, { cause, expose: false });
  }
}

const GENERIC_MESSAGES: Partial<Record<ErrorCode, string>> = {
  internal: 'An unexpected error occurred',
  config_invalid: 'An unexpected error occurred',
  dependency_unavailable: 'A required service is temporarily unavailable',
};

/**
 * Maps any thrown value to an HTTP status and the standard error body. Unknown errors and
 * non-exposed AppErrors get a generic message so internals (SQL, stack traces, document text)
 * never reach the client.
 */
export function toErrorResponse(err: unknown): { status: number; body: ErrorBody } {
  if (err instanceof AppError) {
    const message = err.expose ? err.message : (GENERIC_MESSAGES[err.code] ?? 'Request failed');
    const body: ErrorBody = { error: { code: err.code, message } };
    if (err.expose && err.details !== undefined) body.error.details = err.details;
    return { status: err.httpStatus, body };
  }
  return {
    status: 500,
    body: { error: { code: 'internal', message: 'An unexpected error occurred' } },
  };
}
