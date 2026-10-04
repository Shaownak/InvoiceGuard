import type { Metadata } from 'next';
import { LoginForm } from '@/components/auth/auth-forms';
import { Card } from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'Sign in | InvoiceGuard' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { next } = await searchParams;
  return (
    <Card>
      <h1 className="mb-6 text-2xl font-semibold">Sign in</h1>
      <LoginForm next={typeof next === 'string' ? next : null} />
    </Card>
  );
}
