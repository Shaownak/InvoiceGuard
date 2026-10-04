import { z } from 'zod';
import { apiRoute } from '@/server/api';
import { emailField } from '@/server/schemas';

// No length policy on sign-in: accounts may predate a policy change.
const body = z.strictObject({ email: emailField, password: z.string().min(1).max(1024) });

export const POST = apiRoute({ auth: 'public', body }, async ({ body, services, meta }) => ({
  body: { status: 'signed_in' },
  session: await services.auth.login(body, meta),
}));
