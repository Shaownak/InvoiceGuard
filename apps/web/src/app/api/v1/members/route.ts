import { apiRoute } from '@/server/api';

/** Members of the active organization; visible to every role. */
export const GET = apiRoute({ auth: 'org' }, async ({ session, services }) => ({
  body: { members: await services.orgs.listMembers(session) },
}));
