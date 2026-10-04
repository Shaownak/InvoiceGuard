import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, safeNextPath, tokenFromHash } from './api-client';

describe('tokenFromHash', () => {
  it('reads the token from a fragment', () => {
    expect(tokenFromHash('#token=abc_DEF-123')).toBe('abc_DEF-123');
    expect(tokenFromHash('token=x')).toBe('x');
    expect(tokenFromHash('')).toBeNull();
    expect(tokenFromHash('#token=')).toBeNull();
  });
});

describe('safeNextPath', () => {
  it.each([
    ['/invite', '/invite'],
    ['/app/settings/members', '/app/settings/members'],
    ['//evil.example', '/app'],
    ['https://evil.example', '/app'],
    ['/\\evil.example', '/app'],
    [null, '/app'],
  ])('%s -> %s', (next, expected) => {
    expect(safeNextPath(next)).toBe(expected);
  });
});

describe('api', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps the standard error shape, including field errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          Response.json(
            {
              error: {
                code: 'validation_failed',
                message: 'Please check the highlighted fields',
                details: [{ path: 'email', message: 'Enter a valid email address' }],
              },
            },
            { status: 400 },
          ),
        ),
      ),
    );
    const err = await api('/auth/login', { body: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 400,
      code: 'validation_failed',
      fieldErrors: { email: 'Enter a valid email address' },
    });
  });

  it('returns null for 204 and reports network failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
    );
    expect(await api('/auth/logout')).toBeNull();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    );
    await expect(api('/auth/logout')).rejects.toMatchObject({ code: 'network' });
  });
});
