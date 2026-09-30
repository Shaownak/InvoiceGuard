import { z } from 'zod';
import { NotFoundError } from '@invoiceguard/shared/errors';
import { roleSchema } from '@invoiceguard/shared/permissions';
import { passwordSchema } from './auth/password';

/** Request body fields shared by the /api/v1 routes (Zod at every HTTP boundary). */

export const emailField = z
  .string()
  .trim()
  .max(320, 'Email is too long')
  .pipe(z.email('Enter a valid email address'));

export const personNameField = z
  .string()
  .trim()
  .min(1, 'Enter your name')
  .max(200, 'Use at most 200 characters');

export const orgNameField = z
  .string()
  .trim()
  .min(1, 'Enter an organization name')
  .max(200, 'Use at most 200 characters');

/** Opaque tokens are checked for shape in the services; this only bounds the input size. */
export const tokenField = z.string().min(1).max(128);

export { passwordSchema as passwordField, roleSchema as roleField };

const uuid = z.uuid();

/** Route ids are UUIDs; anything else is simply not found (never a database cast error). */
export function parseId(value: string | undefined): string {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw new NotFoundError();
  return parsed.data;
}
