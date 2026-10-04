import type { Metadata } from 'next';
import { TokenAction } from '@/components/auth/auth-forms';
import { Card } from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'Confirm email | InvoiceGuard' };

export default function VerifyEmailPage() {
  return (
    <Card>
      <h1 className="mb-2 text-2xl font-semibold">Confirm your email</h1>
      <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">One click and you are in.</p>
      <TokenAction endpoint="/auth/verify" actionLabel="Confirm email" pendingLabel="Confirming…" />
    </Card>
  );
}
