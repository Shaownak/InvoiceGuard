import type { Metadata } from 'next';
import Link from 'next/link';
import { ROLE_LABELS } from '@invoiceguard/shared/permissions';
import { CreateOrgForm } from '@/components/app/session-controls';
import { Card } from '@/components/ui/primitives';
import { requirePageSession } from '@/server/page-session';
import { getRuntime } from '@/server/runtime';

export const metadata: Metadata = { title: 'Overview | InvoiceGuard' };

export default async function OverviewPage() {
  const session = await requirePageSession();
  if (session.org === null) {
    return (
      <Card className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">You are not in an organization yet</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Create one to get started, or ask an admin of an existing organization to invite you.
        </p>
        <CreateOrgForm />
      </Card>
    );
  }
  const org = await getRuntime().services.orgs.getActiveOrganization({
    ...session,
    org: session.org,
  });
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{org?.name ?? 'Organization'}</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Signed in as {session.user.email} · {ROLE_LABELS[session.org.role]}
        </p>
      </div>
      <Card>
        <h2 className="mb-2 text-lg font-semibold">Getting started</h2>
        <ul className="list-inside list-disc text-sm text-slate-700 dark:text-slate-300">
          <li>
            <Link href="/app/settings/members" className="underline underline-offset-4">
              Invite your team
            </Link>
          </li>
          <li>Import vendors and purchase orders (coming soon)</li>
          <li>Upload your first invoice (coming soon)</li>
        </ul>
      </Card>
    </div>
  );
}
