import { z } from 'zod';
import { apiRoute } from '@/server/api';
import { parseId, roleField } from '@/server/schemas';

export const PATCH = apiRoute(
  { auth: 'org', permission: 'members.manage', body: z.strictObject({ role: roleField }) },
  async ({ params, body, session, services, meta }) => {
    await services.orgs.changeRole(session, parseId(params.id), body.role, meta);
    return { status: 204 };
  },
);

export const DELETE = apiRoute(
  { auth: 'org', permission: 'members.manage' },
  async ({ params, session, services, meta }) => {
    await services.orgs.removeMember(session, parseId(params.id), meta);
    return { status: 204 };
  },
);
