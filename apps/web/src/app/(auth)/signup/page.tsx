import type { Metadata } from 'next';
import { SignupForm } from '@/components/auth/auth-forms';
import { Card } from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'Create account | InvoiceGuard' };

export default function SignupPage() {
  return (
    <Card>
      <h1 className="mb-1 text-2xl font-semibold">Create your account</h1>
      <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">
        Audit supplier invoices before you pay them.
      </p>
      <SignupForm />
    </Card>
  );
}
