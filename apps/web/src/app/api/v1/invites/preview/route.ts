import { z } from 'zod';
import { apiRoute } from '@/server/api';
import { tokenField } from '@/server/schemas';

/** Org, address, role and status of an invite for the accept page (POST keeps the token out of URLs). */
export const POST = apiRoute(
  { auth: 'public', body: z.strictObject({ token: tokenField }) },
  async ({ body, services }) => ({ body: await services.orgs.previewInvite(body.token) }),
);
