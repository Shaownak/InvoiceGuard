import type { Metadata } from 'next';
import { InviteAccept } from '@/components/auth/invite-accept';
import { Card } from '@/components/ui/primitives';
import { getPageSession } from '@/server/page-session';

export const metadata: Metadata = { title: 'Accept invitation | InvoiceGuard' };

export default async function InvitePage() {
  const session = await getPageSession();
  return (
    <Card>
      <h1 className="mb-4 text-2xl font-semibold">Accept invitation</h1>
      <InviteAccept signedInEmail={session?.user.email ?? null} />
    </Card>
  );
}
