import { apiRoute } from '@/server/api';
import { parseId } from '@/server/schemas';

export const DELETE = apiRoute(
  { auth: 'org', permission: 'members.manage' },
  async ({ params, session, services, meta }) => {
    await services.orgs.revokeInvite(session, parseId(params.id), meta);
    return { status: 204 };
  },
);
