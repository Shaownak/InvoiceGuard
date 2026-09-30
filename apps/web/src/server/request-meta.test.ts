import { describe, expect, it } from 'vitest';
import { isSameOrigin, requestMeta } from './request-meta';

const APP = 'http://localhost:3000';

describe('isSameOrigin', () => {
  it('accepts a matching Origin', () => {
    expect(isSameOrigin(new Headers({ origin: 'http://localhost:3000' }), APP)).toBe(true);
  });

  it.each(['http://evil.example', 'http://localhost:3001', 'https://localhost:3000', 'null'])(
    'rejects Origin %s',
    (origin) => {
      expect(isSameOrigin(new Headers({ origin }), APP)).toBe(false);
    },
  );

  it('falls back to Sec-Fetch-Site only when Origin is absent', () => {
    expect(isSameOrigin(new Headers({ 'sec-fetch-site': 'same-origin' }), APP)).toBe(true);
    expect(isSameOrigin(new Headers({ 'sec-fetch-site': 'cross-site' }), APP)).toBe(false);
    expect(isSameOrigin(new Headers(), APP)).toBe(false);
    expect(
      isSameOrigin(
        new Headers({ origin: 'http://evil.example', 'sec-fetch-site': 'same-origin' }),
        APP,
      ),
    ).toBe(false);
  });
});

describe('requestMeta', () => {
  const headers = new Headers({
    'x-forwarded-for': '203.0.113.9, 10.0.0.1',
    'user-agent': 'Mozilla/5.0',
  });

  it('ignores X-Forwarded-For unless proxy headers are trusted', () => {
    expect(requestMeta(headers, false)).toEqual({ ip: null, userAgent: 'Mozilla/5.0' });
    expect(requestMeta(headers, true)).toEqual({ ip: '203.0.113.9', userAgent: 'Mozilla/5.0' });
  });

  it('drops a forwarded value that is not an IP', () => {
    const forged = new Headers({ 'x-forwarded-for': "1.2.3.4'; DROP TABLE x;--" });
    expect(requestMeta(forged, true).ip).toBeNull();
  });

  it('truncates very long user agents', () => {
    const long = new Headers({ 'user-agent': 'x'.repeat(2000) });
    expect(requestMeta(long, false).userAgent).toHaveLength(512);
  });
});
