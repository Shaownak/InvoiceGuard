import { ValidationError } from '@invoiceguard/shared/errors';
import { describe, expect, it } from 'vitest';
import { assertValidKey } from './keys';

describe('assertValidKey', () => {
  it.each([
    'orgs/0192f3a4-1b2c-7d3e-8f40-123456789abc/documents/0192f3a4-1b2c-7d3e-8f40-123456789abd',
    'health/probe.txt',
    'a',
    'reports/2026-09/summary_v1.pdf',
  ])('accepts %s', (key) => {
    expect(() => {
      assertValidKey(key);
    }).not.toThrow();
  });

  it.each([
    '',
    '../etc/passwd',
    'orgs/../../secret',
    'orgs/./x',
    '/absolute/path',
    'trailing/',
    'double//slash',
    'back\\slash',
    '.env',
    'orgs/.hidden',
    'spaces are bad',
    'unicode/é',
    'C:/windows',
    'x'.repeat(513),
  ])('rejects %j', (key) => {
    expect(() => {
      assertValidKey(key);
    }).toThrow(ValidationError);
  });
});
