import type { z } from 'zod';
import {
  AppError,
  ForbiddenError,
  RateLimitedError,
  UnauthenticatedError,
  ValidationError,
  toErrorResponse,
} from '@invoiceguard/shared/errors';
import { authorize, type Capability } from '@invoiceguard/shared/permissions';
import { clearSessionCookie, readSessionToken, serializeSessionCookie } from './auth/cookies';
import { isSameOrigin, requestMeta } from './request-meta';
import { getRuntime, type Runtime } from './runtime';
import type {
  IssuedSession,
  OrgSessionContext,
  RequestMeta,
  Services,
  SessionContext,
} from './services';

/**
 * The single wrapper every /api/v1 route goes through, so each concern is handled in one
 * place: CSRF origin check, session resolution, `authorize()`, Zod body validation, the
 * standard error shape, no-store caching, and session cookies.
 */

type AuthMode = 'public' | 'user' | 'org';

type SessionFor<M extends AuthMode> = M extends 'public'
  ? SessionContext | null
  : M extends 'user'
    ? SessionContext
    : OrgSessionContext;

export interface ApiContext<M extends AuthMode, B> {
  request: Request;
  body: B;
  params: Record<string, string>;
  session: SessionFor<M>;
  meta: RequestMeta;
  services: Services;
  runtime: Runtime;
}

export interface ApiResult {
  status?: number;
  body?: unknown;
  /** Sets the session cookie to this new session. */
  session?: IssuedSession;
  /** Clears the session cookie. */
  clearSession?: boolean;
}

export interface RouteOptions<M extends AuthMode, S extends z.ZodType | undefined> {
  auth: M;
  body?: S;
  /** Checked against the active org role before the handler runs (`auth: 'org'` only). */
  permission?: M extends 'org' ? Capability : never;
}

type Handler<M extends AuthMode, S extends z.ZodType | undefined> = (
  ctx: ApiContext<M, S extends z.ZodType ? z.infer<S> : undefined>,
) => Promise<ApiResult>;

// Next.js passes `params` only to dynamic routes; static routes get a context without it.
type RouteParams = { params?: Promise<Record<string, string | string[] | undefined>> };

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function apiRoute<M extends AuthMode, S extends z.ZodType | undefined = undefined>(
  options: RouteOptions<M, S>,
  handler: Handler<M, S>,
): (request: Request, context?: RouteParams) => Promise<Response> {
  return async (request, context) => {
    let runtime: Runtime | undefined;
    try {
      runtime = getRuntime();
      const { env, services, sessionCookie } = runtime;

      if (!SAFE_METHODS.has(request.method) && !isSameOrigin(request.headers, env.APP_URL)) {
        throw new ForbiddenError('Cross-site request refused');
      }

      const token = readSessionToken(sessionCookie, request.headers.get('cookie'));
      const session = token === null ? null : await services.auth.authenticate(token);
      if (options.auth !== 'public' && session === null) throw new UnauthenticatedError();
      if (options.auth === 'org' || options.permission !== undefined) {
        if (session === null || session.org === null) {
          throw new ForbiddenError('Create or join an organization first');
        }
        if (options.permission !== undefined) authorize(session.org, options.permission);
      }

      const body = options.body === undefined ? undefined : await parseBody(request, options.body);
      const params = Object.fromEntries(
        Object.entries((await context?.params) ?? {}).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      );

      const result = await handler({
        request,
        // The branches above guarantee the session matches the declared auth mode.
        session: session as SessionFor<M>,
        body: body as S extends z.ZodType ? z.infer<S> : undefined,
        params,
        meta: requestMeta(request.headers, env.TRUST_PROXY_HEADERS),
        services,
        runtime,
      });

      const headers = new Headers({ 'Cache-Control': 'no-store' });
      if (result.session !== undefined) {
        headers.append(
          'Set-Cookie',
          serializeSessionCookie(sessionCookie, result.session.token, result.session.expiresAt),
        );
      }
      if (result.clearSession === true)
        headers.append('Set-Cookie', clearSessionCookie(sessionCookie));
      const status = result.status ?? 200;
      if (status === 204) return new Response(null, { status, headers });
      return Response.json(result.body ?? null, { status, headers });
    } catch (err) {
      return errorResponse(err, runtime);
    }
  };
}

async function parseBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S>> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    throw new ValidationError('Request body must be JSON');
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ValidationError(
      'Please check the highlighted fields',
      parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return parsed.data;
}

function errorResponse(err: unknown, runtime: Runtime | undefined): Response {
  const { status, body } = toErrorResponse(err);
  if (!(err instanceof AppError) || status >= 500) {
    // Name, message and SQLSTATE only: driver errors carry `detail` with row values (emails).
    const e = err instanceof Error ? err : new Error('non-error thrown');
    const code = 'code' in e && typeof e.code === 'string' ? e.code : undefined;
    runtime?.logger.error(
      { err: { name: e.name, message: e.message, code, stack: e.stack } },
      'request failed',
    );
  }
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  if (err instanceof RateLimitedError) headers.set('Retry-After', String(err.retryAfterSeconds));
  return Response.json(body, { status, headers });
}
