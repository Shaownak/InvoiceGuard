import { z } from 'zod';
import { apiRoute } from '@/server/api';
import { passwordField, tokenField } from '@/server/schemas';

/** Sets the new password, signs out every other session, and signs in here. */
export const POST = apiRoute(
  { auth: 'public', body: z.strictObject({ token: tokenField, password: passwordField }) },
  async ({ body, services, meta }) => ({
    body: { status: 'signed_in' },
    session: await services.auth.resetPassword(body.token, body.password, meta),
  }),
);
