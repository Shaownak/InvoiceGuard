import { apiRoute } from '@/server/api';
import { parseId } from '@/server/schemas';

/** Switches the session to another org the caller belongs to (new session token). */
export const POST = apiRoute({ auth: 'user' }, async ({ params, session, services, meta }) => {
  const issued = await services.orgs.switchOrganization(session, parseId(params.id), meta);
  return { body: { id: issued.orgId }, session: issued };
});
