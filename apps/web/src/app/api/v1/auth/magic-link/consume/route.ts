import { z } from 'zod';
import { apiRoute } from '@/server/api';
import { tokenField } from '@/server/schemas';

export const POST = apiRoute(
  { auth: 'public', body: z.strictObject({ token: tokenField }) },
  async ({ body, services, meta }) => ({
    body: { status: 'signed_in' },
    session: await services.auth.consumeMagicLink(body.token, meta),
  }),
);
