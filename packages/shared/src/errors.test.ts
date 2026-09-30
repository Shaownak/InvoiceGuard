import { describe, expect, it } from 'vitest';
import {
  AppError,
  ConfigError,
  DependencyUnavailableError,
  NotFoundError,
  ValidationError,
  toErrorResponse,
} from './errors';

describe('toErrorResponse', () => {
  it('maps a client error with its message and details', () => {
    const res = toErrorResponse(new ValidationError('Bad input', { field: 'total' }));
    expect(res).toEqual({
      status: 400,
      body: {
        error: { code: 'validation_failed', message: 'Bad input', details: { field: 'total' } },
      },
    });
  });

  it('maps not found to 404', () => {
    expect(toErrorResponse(new NotFoundError()).status).toBe(404);
  });

  it('hides the message and details of server-side errors', () => {
    const res = toErrorResponse(new ConfigError('DATABASE_URL is wrong', { secret: 'x' }));
    expect(res.status).toBe(500);
    expect(res.body.error.message).toBe('An unexpected error occurred');
    expect(res.body.error.details).toBeUndefined();
  });

  it('maps dependency failures to 503 with a generic message', () => {
    const res = toErrorResponse(new DependencyUnavailableError('redis', new Error('ECONNREFUSED')));
    expect(res.status).toBe(503);
    expect(res.body.error.message).not.toContain('ECONNREFUSED');
  });

  it('maps unknown thrown values to a generic 500', () => {
    for (const thrown of [new Error('select * from secrets'), 'boom', null, 42]) {
      const res = toErrorResponse(thrown);
      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        error: { code: 'internal', message: 'An unexpected error occurred' },
      });
    }
  });

  it('allows explicitly exposing a server error message', () => {
    const res = toErrorResponse(new AppError('internal', 'Try again later', { expose: true }));
    expect(res.body.error.message).toBe('Try again later');
  });

  it('keeps the subclass name and cause', () => {
    const cause = new Error('root');
    const err = new DependencyUnavailableError('db', cause);
    expect(err.name).toBe('DependencyUnavailableError');
    expect(err.cause).toBe(cause);
  });
});
