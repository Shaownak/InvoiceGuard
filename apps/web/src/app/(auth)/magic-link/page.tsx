import type { Metadata } from 'next';
import { TokenAction } from '@/components/auth/auth-forms';
import { Card } from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'Sign in | InvoiceGuard' };

export default function MagicLinkPage() {
  return (
    <Card>
      <h1 className="mb-6 text-2xl font-semibold">Sign in with your email link</h1>
      <TokenAction
        endpoint="/auth/magic-link/consume"
        actionLabel="Sign in"
        pendingLabel="Signing in…"
      />
    </Card>
  );
}
