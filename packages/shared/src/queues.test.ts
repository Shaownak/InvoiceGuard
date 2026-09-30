import { describe, expect, it } from 'vitest';
import { deterministicJobId, systemJobSchema } from './queues';

describe('deterministicJobId', () => {
  it('joins kind and entity id with a BullMQ-safe separator', () => {
    const id = deterministicJobId('extract', '0192f3a4-1b2c-7d3e-8f40-123456789abc');
    expect(id).toBe('extract.0192f3a4-1b2c-7d3e-8f40-123456789abc');
    expect(id).not.toContain(':');
  });

  it('is stable for the same inputs and distinct across kinds', () => {
    expect(deterministicJobId('match', 'a1')).toBe(deterministicJobId('match', 'a1'));
    expect(deterministicJobId('match', 'a1')).not.toBe(deterministicJobId('extract', 'a1'));
  });

  it.each([
    ['Extract', 'a'],
    ['extract:', 'a'],
    ['', 'a'],
    ['extract', ''],
    ['extract', 'a:b'],
    ['extract', 'a.b'],
    ['extract', '../x'],
  ])('rejects kind=%j entity=%j', (kind, entity) => {
    expect(() => deterministicJobId(kind, entity)).toThrow();
  });
});

describe('systemJobSchema', () => {
  it('accepts a ping and rejects unknown jobs', () => {
    expect(systemJobSchema.safeParse({ name: 'ping', data: { nonce: 'x' } }).success).toBe(true);
    expect(systemJobSchema.safeParse({ name: 'other', data: {} }).success).toBe(false);
  });
});
