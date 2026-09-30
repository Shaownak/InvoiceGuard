import { z } from 'zod';
import { apiRoute } from '@/server/api';
import { emailField } from '@/server/schemas';

/** Emails a reset link. Always 202 (no account enumeration). */
export const POST = apiRoute(
  { auth: 'public', body: z.strictObject({ email: emailField }) },
  async ({ body, services }) => {
    await services.auth.requestPasswordReset(body.email);
    return { status: 202, body: { status: 'sent_if_applicable' } };
  },
);
