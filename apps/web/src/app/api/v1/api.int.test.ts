import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import {
  seedMembership,
  seedTenant,
  seedUser,
  uniqueEmail,
  type SeededTenant,
} from '@invoiceguard/db/testing';
import { ROLES, type Role } from '@invoiceguard/shared/permissions';
import { closeRuntime } from '@/server/runtime';
import { setPassword } from '@/server/testing';
import { POST as login } from './auth/login/route';
import { POST as logout } from './auth/logout/route';
import { POST as signup } from './auth/signup/route';
import { DELETE as revokeInvite } from './invites/[id]/route';
import { GET as listInvites, POST as createInvite } from './invites/route';
import { GET as me } from './me/route';
import { DELETE as removeMember, PATCH as patchMember } from './members/[id]/route';
import { GET as listMembers } from './members/route';

// HTTP-level checks through the real route handlers and runtime (Postgres, Redis, file
// mailer): CSRF, cookies, error shape, rate limiting, and the permission matrix per role.

const infra = inject('testInfra');
const APP = 'http://localhost:3000';
const PASSWORD = 'correct horse battery staple';
const MANAGERS: readonly Role[] = ['owner', 'admin'];

let mailDir: string;

beforeAll(async () => {
  mailDir = await mkdtemp(join(tmpdir(), 'ig-api-mail-'));
  const env: Record<string, string> = {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    APP_URL: APP,
    DATABASE_URL: infra.postgres.appUrl,
    REDIS_URL: infra.redisUrl,
    STORAGE_DRIVER: 'fs',
    STORAGE_FS_ROOT: mailDir,
    SESSION_SECRET: 'api-test-session-secret-0123456789abcdef',
    EMAIL_FROM: 'InvoiceGuard <no-reply@invoiceguard.test>',
    EMAIL_TRANSPORT: 'file',
    EMAIL_FILE_DIR: mailDir,
  };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
});

afterAll(async () => {
  await closeRuntime();
  vi.unstubAllEnvs();
  await rm(mailDir, { recursive: true, force: true });
});

interface Options {
  body?: unknown;
  cookie?: string;
  origin?: string | null;
}

function request(method: string, path: string, options: Options = {}): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  const origin = options.origin === undefined ? APP : options.origin;
  if (origin !== null) headers.set('origin', origin);
  if (options.cookie !== undefined) headers.set('cookie', options.cookie);
  return new Request(`${APP}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

// What Next.js passes to a static route: a context without `params` (an earlier version of
// the wrapper assumed params were always present and failed every static route).
const noParams = {};
const withId = (id: string) => ({ params: Promise.resolve({ id }) });

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

/** Signs in through the login route and returns the Cookie header value to send back. */
async function signIn(email: string): Promise<string> {
  const res = await login(
    request('POST', '/api/v1/auth/login', { body: { email, password: PASSWORD } }),
    noParams,
  );
  expect(res.status).toBe(200);
  const setCookie = res.headers.get('set-cookie') ?? '';
  return setCookie.split(';')[0] ?? '';
}

async function userWithRole(orgId: string, role: Role) {
  const user = await seedUser(infra.postgres.ownerUrl);
  await setPassword(infra.postgres.ownerUrl, user.userId, PASSWORD);
  const membershipId = await seedMembership(infra.postgres.ownerUrl, orgId, user.userId, role);
  return { ...user, membershipId, cookie: await signIn(user.email) };
}

describe('sessions over HTTP', () => {
  let tenant: SeededTenant;
  beforeAll(async () => {
    tenant = await seedTenant(infra.postgres.ownerUrl);
    await setPassword(infra.postgres.ownerUrl, tenant.owner.userId, PASSWORD);
  });

  it('sets an httpOnly, SameSite=Lax session cookie and no-store caching on sign-in', async () => {
    const res = await login(
      request('POST', '/api/v1/auth/login', {
        body: { email: tenant.owner.email, password: PASSWORD },
      }),
      noParams,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(
      /^ig_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Expires=/,
    );
  });

  it('GET /me returns the user and active org with a cookie, 401 without', async () => {
    const cookie = await signIn(tenant.owner.email);
    const ok = await me(request('GET', '/api/v1/me', { cookie }), noParams);
    expect(ok.status).toBe(200);
    expect(await json(ok)).toMatchObject({
      user: { email: tenant.owner.email },
      activeOrg: { id: tenant.orgId, role: 'owner' },
    });
    const anon = await me(request('GET', '/api/v1/me'), noParams);
    expect(anon.status).toBe(401);
    expect(await json(anon)).toEqual({
      error: { code: 'unauthenticated', message: 'Please sign in to continue' },
    });
  });

  it('logout clears the cookie and ends the session', async () => {
    const cookie = await signIn(tenant.owner.email);
    const res = await logout(request('POST', '/api/v1/auth/logout', { cookie }), noParams);
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await me(request('GET', '/api/v1/me', { cookie }), noParams)).status).toBe(401);
  });
});

describe('CSRF (Origin check on mutations)', () => {
  it.each([
    ['no Origin header', null],
    ['a foreign Origin', 'https://evil.example'],
  ])('refuses a POST with %s', async (_, origin) => {
    const res = await login(
      request('POST', '/api/v1/auth/login', { origin, body: { email: 'a@b.test', password: 'x' } }),
      noParams,
    );
    expect(res.status).toBe(403);
    expect(await json(res)).toEqual({
      error: { code: 'forbidden', message: 'Cross-site request refused' },
    });
  });

  it('allows GET without an Origin', async () => {
    expect((await me(request('GET', '/api/v1/me', { origin: null }), noParams)).status).toBe(401);
  });
});

describe('validation and rate limiting', () => {
  it('returns 400 with field details for an invalid body', async () => {
    const res = await signup(
      request('POST', '/api/v1/auth/signup', {
        body: { email: 'not-an-email', password: 'short' },
      }),
      noParams,
    );
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body).toMatchObject({ error: { code: 'validation_failed' } });
  });

  it('returns 400 for a non-JSON body', async () => {
    const req = new Request(`${APP}/api/v1/auth/login`, {
      method: 'POST',
      headers: { origin: APP },
      body: 'not json',
    });
    expect((await login(req, noParams)).status).toBe(400);
  });

  it('signup answers 202 for new and existing addresses alike', async () => {
    const email = uniqueEmail('dup');
    const body = { name: 'A', email, password: PASSWORD, orgName: 'A Co' };
    const first = await signup(request('POST', '/api/v1/auth/signup', { body }), noParams);
    const second = await signup(request('POST', '/api/v1/auth/signup', { body }), noParams);
    expect([first.status, second.status]).toEqual([202, 202]);
    expect(await json(first)).toEqual(await json(second));
  });

  it('limits password attempts per address (429 with Retry-After)', async () => {
    const email = uniqueEmail('brute');
    const attempt = () =>
      login(
        request('POST', '/api/v1/auth/login', { body: { email, password: 'wrong-password' } }),
        noParams,
      );
    for (let i = 0; i < 10; i++) expect((await attempt()).status).toBe(401);
    const limited = await attempt();
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await json(limited)).toMatchObject({ error: { code: 'rate_limited' } });
  });
});

describe('member management permissions, per role', () => {
  let tenant: SeededTenant;
  const users = new Map<Role, Awaited<ReturnType<typeof userWithRole>>>();

  beforeAll(async () => {
    tenant = await seedTenant(infra.postgres.ownerUrl);
    for (const role of ROLES) users.set(role, await userWithRole(tenant.orgId, role));
  });

  const actor = (role: Role) => {
    const u = users.get(role);
    if (u === undefined) throw new Error(`no ${role}`);
    return u;
  };

  it.each(ROLES)('%s: can list members', async (role) => {
    const res = await listMembers(
      request('GET', '/api/v1/members', { cookie: actor(role).cookie }),
      noParams,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { members: { role: string }[] };
    expect(body.members).toHaveLength(ROLES.length + 1);
  });

  it.each(ROLES)('%s: invites and pending invites follow "Manage members"', async (role) => {
    const allowed = MANAGERS.includes(role);
    const { cookie } = actor(role);
    const list = await listInvites(request('GET', '/api/v1/invites', { cookie }), noParams);
    expect(list.status).toBe(allowed ? 200 : 403);
    const created = await createInvite(
      request('POST', '/api/v1/invites', {
        cookie,
        body: { email: uniqueEmail('inv'), role: 'viewer' },
      }),
      noParams,
    );
    expect(created.status).toBe(allowed ? 201 : 403);
    if (allowed) {
      const { invite } = (await created.json()) as { invite: { id: string } };
      const revoked = await revokeInvite(
        request('DELETE', `/api/v1/invites/${invite.id}`, { cookie }),
        withId(invite.id),
      );
      expect(revoked.status).toBe(204);
    }
  });

  it.each(ROLES)(
    '%s: changing roles and removing members follow "Manage members"',
    async (role) => {
      const allowed = MANAGERS.includes(role);
      const { cookie } = actor(role);
      const target = await userWithRole(tenant.orgId, 'viewer');
      const patched = await patchMember(
        request('PATCH', `/api/v1/members/${target.membershipId}`, {
          cookie,
          body: { role: 'reviewer' },
        }),
        withId(target.membershipId),
      );
      expect(patched.status).toBe(allowed ? 204 : 403);
      const removed = await removeMember(
        request('DELETE', `/api/v1/members/${target.membershipId}`, { cookie }),
        withId(target.membershipId),
      );
      expect(removed.status).toBe(allowed ? 204 : 403);
    },
  );

  it('answers 404 for a malformed or foreign member id', async () => {
    const { cookie } = actor('owner');
    const bad = await patchMember(
      request('PATCH', '/api/v1/members/not-a-uuid', { cookie, body: { role: 'viewer' } }),
      withId('not-a-uuid'),
    );
    expect(bad.status).toBe(404);
    const other = await seedTenant(infra.postgres.ownerUrl);
    const foreignId = await seedMembership(
      infra.postgres.ownerUrl,
      other.orgId,
      (await seedUser(infra.postgres.ownerUrl)).userId,
      'viewer',
    );
    const foreign = await removeMember(
      request('DELETE', `/api/v1/members/${foreignId}`, { cookie }),
      withId(foreignId),
    );
    expect(foreign.status).toBe(404);
  });

  it('refuses org routes to a user without an organization', async () => {
    const loner = await seedUser(infra.postgres.ownerUrl);
    await setPassword(infra.postgres.ownerUrl, loner.userId, PASSWORD);
    const cookie = await signIn(loner.email);
    const res = await listMembers(request('GET', '/api/v1/members', { cookie }), noParams);
    expect(res.status).toBe(403);
    expect(await json(res)).toMatchObject({
      error: { message: 'Create or join an organization first' },
    });
  });
});
