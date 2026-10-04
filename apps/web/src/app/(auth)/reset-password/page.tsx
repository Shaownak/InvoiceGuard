import type { Metadata } from 'next';
import { ResetRequestForm } from '@/components/auth/auth-forms';
import { Card } from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'Reset password | InvoiceGuard' };

export default function ResetPasswordPage() {
  return (
    <Card>
      <h1 className="mb-2 text-2xl font-semibold">Reset your password</h1>
      <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">
        Enter the email you sign in with and we will send you a link.
      </p>
      <ResetRequestForm />
    </Card>
  );
}
