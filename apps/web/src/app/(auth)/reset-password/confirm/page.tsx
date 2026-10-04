import type { Metadata } from 'next';
import { ResetConfirmForm } from '@/components/auth/auth-forms';
import { Card } from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'Choose a new password | InvoiceGuard' };

export default function ResetPasswordConfirmPage() {
  return (
    <Card>
      <h1 className="mb-2 text-2xl font-semibold">Choose a new password</h1>
      <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">
        This signs you out on every other device.
      </p>
      <ResetConfirmForm />
    </Card>
  );
}
