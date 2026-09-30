import { describe, expect, it } from 'vitest';
import { slugBase } from './organizations';

describe('slugBase', () => {
  it.each([
    ['Acme', 'acme'],
    ['  Müller & Söhne GmbH  ', 'muller-sohne-gmbh'],
    ['!!!', 'org'],
    ['a'.repeat(60), 'a'.repeat(40)],
    [`${'b'.repeat(39)} c`, 'b'.repeat(39)],
  ])('%s -> %s', (name, slug) => {
    expect(slugBase(name)).toBe(slug);
  });
});
