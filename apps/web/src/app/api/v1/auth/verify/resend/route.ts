import { z } from 'zod';
import { apiRoute } from '@/server/api';
import { emailField } from '@/server/schemas';

/** Always 202, so the response does not reveal whether the address has an account. */
export const POST = apiRoute(
  { auth: 'public', body: z.strictObject({ email: emailField }) },
  async ({ body, services }) => {
    await services.auth.resendVerification(body.email);
    return { status: 202, body: { status: 'sent_if_applicable' } };
  },
);
