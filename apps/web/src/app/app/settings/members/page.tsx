import type { Metadata } from 'next';
import { can } from '@invoiceguard/shared/permissions';
import { MembersPanel } from '@/components/app/members-panel';
import { requireOrgPageSession } from '@/server/page-session';
import { getRuntime } from '@/server/runtime';

export const metadata: Metadata = { title: 'Members | InvoiceGuard' };

export default async function MembersPage() {
  const session = await requireOrgPageSession();
  const { orgs } = getRuntime().services;
  const members = await orgs.listMembers(session);
  const invites = can(session.org.role, 'members.manage') ? await orgs.listInvites(session) : null;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Members</h1>
      <MembersPanel
        members={members.map((m) => ({
          membershipId: m.membershipId,
          userId: m.userId,
          name: m.name,
          email: m.email,
          role: m.role,
        }))}
        invites={
          invites === null
            ? null
            : invites.map((i) => ({
                id: i.id,
                email: i.email,
                role: i.role,
                expiresAt: i.expiresAt.toISOString(),
              }))
        }
        actorRole={session.org.role}
        actorUserId={session.user.id}
      />
    </div>
  );
}
