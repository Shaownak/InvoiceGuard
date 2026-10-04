/**
 * Browser-side calls to /api/v1. Same-origin fetch, so the browser attaches the session
 * cookie and the Origin header the API requires for mutations.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Field errors from a 400, keyed by field path. */
  readonly fieldErrors: Record<string, string>;

  constructor(status: number, code: string, message: string, fieldErrors: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toApiError(status: number, payload: unknown): ApiError {
  const error = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
  const code = typeof error.code === 'string' ? error.code : 'internal';
  const message =
    typeof error.message === 'string' ? error.message : 'Something went wrong. Please try again.';
  const fieldErrors: Record<string, string> = {};
  if (Array.isArray(error.details)) {
    for (const detail of error.details) {
      if (
        isRecord(detail) &&
        typeof detail.path === 'string' &&
        typeof detail.message === 'string'
      ) {
        fieldErrors[detail.path] ??= detail.message;
      }
    }
  }
  return new ApiError(status, code, message, fieldErrors);
}

export async function api(
  path: string,
  options: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown } = {},
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: options.method ?? 'POST',
      headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'network', 'Could not reach the server. Check your connection.', {});
  }
  const payload: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw toApiError(res.status, payload);
  return payload;
}

/** Reads `token` from the URL fragment (`#token=...`), where email links put it. */
export function tokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('token');
  return token === null || token === '' ? null : token;
}

/** Only same-site relative paths, so `?next=` cannot redirect off-site. */
export function safeNextPath(next: string | null | undefined, fallback = '/app'): string {
  if (
    typeof next !== 'string' ||
    !next.startsWith('/') ||
    next.startsWith('//') ||
    next.includes('\\')
  ) {
    return fallback;
  }
  return next;
}
