import { z } from 'zod';
import { apiRoute } from '@/server/api';
import { orgNameField } from '@/server/schemas';

export const GET = apiRoute({ auth: 'user' }, async ({ session, services }) => {
  const orgs = await services.orgs.listMyOrganizations(session.user.id);
  return { body: { orgs: orgs.map((o) => ({ id: o.orgId, name: o.name, role: o.role })) } };
});

/** Creates an organization owned by the caller and switches the session to it. */
export const POST = apiRoute(
  { auth: 'user', body: z.strictObject({ name: orgNameField }) },
  async ({ body, session, services, meta }) => {
    const issued = await services.orgs.createOrganization(session, body.name, meta);
    return { status: 201, body: { id: issued.orgId }, session: issued };
  },
);
