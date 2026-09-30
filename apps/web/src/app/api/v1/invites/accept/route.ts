import { z } from 'zod';
import { apiRoute } from '@/server/api';
import { tokenField } from '@/server/schemas';

/** A signed-in user joins the inviting org; the session switches to it. */
export const POST = apiRoute(
  { auth: 'user', body: z.strictObject({ token: tokenField }) },
  async ({ body, session, services, meta }) => {
    const issued = await services.orgs.acceptInvite(session, body.token, meta);
    return { body: { id: issued.orgId }, session: issued };
  },
);
