import { z } from 'zod';
import { apiRoute } from '@/server/api';
import { tokenField } from '@/server/schemas';

/** Confirms the email address from the link and signs the user in. */
export const POST = apiRoute(
  { auth: 'public', body: z.strictObject({ token: tokenField }) },
  async ({ body, services, meta }) => ({
    body: { status: 'signed_in' },
    session: await services.auth.verifyEmail(body.token, meta),
  }),
);
