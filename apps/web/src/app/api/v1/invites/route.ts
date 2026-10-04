import { z } from 'zod';
import { apiRoute } from '@/server/api';
import { emailField, roleField } from '@/server/schemas';

export const GET = apiRoute(
  { auth: 'org', permission: 'members.manage' },
  async ({ session, services }) => ({
    body: { invites: await services.orgs.listInvites(session) },
  }),
);

/** Invites someone by email with a role (FR-ORG-3). Re-inviting replaces the open invite. */
export const POST = apiRoute(
  {
    auth: 'org',
    permission: 'members.manage',
    body: z.strictObject({ email: emailField, role: roleField }),
  },
  async ({ body, session, services, meta }) => ({
    status: 201,
    body: { invite: await services.orgs.invite(session, body, meta) },
  }),
);
