import type { Metadata } from 'next';
import { CreateOrgForm } from '@/components/app/session-controls';
import { Card } from '@/components/ui/primitives';
import { requirePageSession } from '@/server/page-session';

export const metadata: Metadata = { title: 'New organization | InvoiceGuard' };

export default async function NewOrganizationPage() {
  await requirePageSession();
  return (
    <Card className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">New organization</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        You will be its owner. Each organization keeps its own invoices, vendors and members.
      </p>
      <CreateOrgForm />
    </Card>
  );
}
