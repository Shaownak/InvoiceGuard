import { apiRoute } from '@/server/api';

/** The signed-in user, their active organization and role, and every org they belong to. */
export const GET = apiRoute({ auth: 'user' }, async ({ session, services }) => {
  const orgs = await services.orgs.listMyOrganizations(session.user.id);
  const active = orgs.find((o) => o.orgId === session.org?.id) ?? null;
  return {
    body: {
      user: session.user,
      activeOrg:
        active === null ? null : { id: active.orgId, name: active.name, role: active.role },
      orgs: orgs.map((o) => ({ id: o.orgId, name: o.name, role: o.role })),
    },
  };
});
