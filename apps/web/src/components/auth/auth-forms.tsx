'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type SubmitEvent } from 'react';
import { Alert, Button, Field, Input, fieldAria } from '@/components/ui/primitives';
import { useSubmit } from '@/components/use-submit';
import { api, safeNextPath, tokenFromHash } from '@/lib/api-client';

const LINK =
  'font-medium text-emerald-700 underline underline-offset-4 hover:text-emerald-900 dark:text-emerald-400';

function formValues(event: SubmitEvent<HTMLFormElement>): Record<string, string> {
  event.preventDefault();
  const values: Record<string, string> = {};
  for (const [key, value] of new FormData(event.currentTarget)) {
    if (typeof value === 'string') values[key] = value;
  }
  return values;
}

export function SignupForm() {
  const { pending, error, fieldErrors, run } = useSubmit();
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    const values = formValues(event);
    const ok = await run(async () => {
      await api('/auth/signup', { body: values });
    });
    if (ok) setSentTo(values.email ?? '');
  }

  if (sentTo !== null) return <CheckInbox email={sentTo} />;

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4" noValidate>
      {error !== null && <Alert variant="error">{error}</Alert>}
      <Field id="name" label="Your name" error={fieldErrors.name}>
        <Input name="name" autoComplete="name" required {...fieldAria('name', fieldErrors.name)} />
      </Field>
      <Field id="email" label="Work email" error={fieldErrors.email}>
        <Input
          name="email"
          type="email"
          autoComplete="email"
          required
          {...fieldAria('email', fieldErrors.email)}
        />
      </Field>
      <Field
        id="password"
        label="Password"
        error={fieldErrors.password}
        hint="At least 12 characters. A short sentence works well."
      >
        <Input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          {...fieldAria('password', fieldErrors.password, 'hint')}
        />
      </Field>
      <Field id="orgName" label="Organization name" error={fieldErrors.orgName}>
        <Input
          name="orgName"
          autoComplete="organization"
          required
          {...fieldAria('orgName', fieldErrors.orgName)}
        />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? 'Creating account…' : 'Create account'}
      </Button>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Already have an account?{' '}
        <Link href="/login" className={LINK}>
          Sign in
        </Link>
      </p>
    </form>
  );
}

function CheckInbox({ email }: { email: string }) {
  const { pending, error, run } = useSubmit();
  const [resent, setResent] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <Alert variant="success">
        Check your inbox: we have sent an email to {email}. Follow the link in it to confirm your
        address. The link expires in 24 hours.
      </Alert>
      {error !== null && <Alert variant="error">{error}</Alert>}
      {resent && <Alert>If a confirmation is pending, we have sent a new link.</Alert>}
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() =>
          void run(async () => {
            await api('/auth/verify/resend', { body: { email } });
            setResent(true);
          })
        }
      >
        Resend confirmation email
      </Button>
    </div>
  );
}

export function LoginForm({ next }: { next: string | null }) {
  const router = useRouter();
  const { pending, error, fieldErrors, run } = useSubmit();
  const [mode, setMode] = useState<'password' | 'magic'>('password');
  const [magicSent, setMagicSent] = useState(false);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    const values = formValues(event);
    if (mode === 'magic') {
      const ok = await run(async () => {
        await api('/auth/magic-link', { body: { email: values.email } });
      });
      if (ok) setMagicSent(true);
      return;
    }
    const ok = await run(async () => {
      await api('/auth/login', { body: values });
    });
    if (ok) {
      router.replace(safeNextPath(next));
      router.refresh();
    }
  }

  if (magicSent) {
    return (
      <Alert variant="success">
        If an account exists for that address, we have emailed a sign-in link. It expires in 15
        minutes.
      </Alert>
    );
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4" noValidate>
      {error !== null && <Alert variant="error">{error}</Alert>}
      <Field id="email" label="Email" error={fieldErrors.email}>
        <Input
          name="email"
          type="email"
          autoComplete="email"
          required
          {...fieldAria('email', fieldErrors.email)}
        />
      </Field>
      {mode === 'password' && (
        <Field id="password" label="Password" error={fieldErrors.password}>
          <Input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            {...fieldAria('password', fieldErrors.password)}
          />
        </Field>
      )}
      <Button type="submit" disabled={pending}>
        {mode === 'password'
          ? pending
            ? 'Signing in…'
            : 'Sign in'
          : pending
            ? 'Sending…'
            : 'Email me a sign-in link'}
      </Button>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <button
          type="button"
          className={LINK}
          onClick={() => {
            setMode(mode === 'password' ? 'magic' : 'password');
          }}
        >
          {mode === 'password' ? 'Email me a sign-in link instead' : 'Use my password instead'}
        </button>
        <Link href="/reset-password" className={LINK}>
          Forgot password?
        </Link>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        New to InvoiceGuard?{' '}
        <Link href="/signup" className={LINK}>
          Create an account
        </Link>
      </p>
    </form>
  );
}

/** Reads the token from the URL fragment once on mount (never sent to the server by the browser). */
function useHashToken(): { token: string | null; ready: boolean } {
  const [state, setState] = useState<{ token: string | null; ready: boolean }>({
    token: null,
    ready: false,
  });
  useEffect(() => {
    setState({ token: tokenFromHash(window.location.hash), ready: true });
  }, []);
  return state;
}

/**
 * Confirm-email and magic-link landing: one click POSTs the token, so mail scanners that
 * prefetch links cannot use it up (ADR-0017).
 */
export function TokenAction({
  endpoint,
  actionLabel,
  pendingLabel,
}: {
  endpoint: '/auth/verify' | '/auth/magic-link/consume';
  actionLabel: string;
  pendingLabel: string;
}) {
  const router = useRouter();
  const { token, ready } = useHashToken();
  const { pending, error, run } = useSubmit();

  if (!ready) return null;
  if (token === null) {
    return (
      <Alert variant="error">
        This link is incomplete. Open it again from the email, or{' '}
        <Link href="/login" className={LINK}>
          sign in
        </Link>
        .
      </Alert>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {error !== null && (
        <Alert variant="error">
          {error}{' '}
          <Link href="/login" className={LINK}>
            Go to sign in
          </Link>
        </Alert>
      )}
      <Button
        disabled={pending}
        onClick={() =>
          void run(async () => {
            await api(endpoint, { body: { token } });
            router.replace('/app');
            router.refresh();
          })
        }
      >
        {pending ? pendingLabel : actionLabel}
      </Button>
    </div>
  );
}

export function ResetRequestForm() {
  const { pending, error, fieldErrors, run } = useSubmit();
  const [sent, setSent] = useState(false);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    const values = formValues(event);
    const ok = await run(async () => {
      await api('/auth/password-reset', { body: { email: values.email } });
    });
    if (ok) setSent(true);
  }

  if (sent) {
    return (
      <Alert variant="success">
        If an account exists for that address, we have emailed a link to reset the password. It
        expires in 1 hour.
      </Alert>
    );
  }
  return (
    <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4" noValidate>
      {error !== null && <Alert variant="error">{error}</Alert>}
      <Field id="email" label="Email" error={fieldErrors.email}>
        <Input
          name="email"
          type="email"
          autoComplete="email"
          required
          {...fieldAria('email', fieldErrors.email)}
        />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? 'Sending…' : 'Email me a reset link'}
      </Button>
      <Link href="/login" className={`${LINK} text-sm`}>
        Back to sign in
      </Link>
    </form>
  );
}

export function ResetConfirmForm() {
  const router = useRouter();
  const { token, ready } = useHashToken();
  const { pending, error, fieldErrors, run } = useSubmit();
  const [mismatch, setMismatch] = useState(false);

  if (!ready) return null;
  if (token === null) {
    return (
      <Alert variant="error">
        This link is incomplete.{' '}
        <Link href="/reset-password" className={LINK}>
          Request a new one
        </Link>
        .
      </Alert>
    );
  }

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    const values = formValues(event);
    if (values.password !== values.confirm) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    const ok = await run(async () => {
      await api('/auth/password-reset/confirm', { body: { token, password: values.password } });
    });
    if (ok) {
      router.replace('/app');
      router.refresh();
    }
  }

  const confirmError = mismatch ? 'The passwords do not match' : undefined;
  return (
    <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4" noValidate>
      {error !== null && (
        <Alert variant="error">
          {error}{' '}
          <Link href="/reset-password" className={LINK}>
            Request a new link
          </Link>
        </Alert>
      )}
      <Field
        id="password"
        label="New password"
        error={fieldErrors.password}
        hint="At least 12 characters."
      >
        <Input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          {...fieldAria('password', fieldErrors.password, 'hint')}
        />
      </Field>
      <Field id="confirm" label="Confirm new password" error={confirmError}>
        <Input
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          {...fieldAria('confirm', confirmError)}
        />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Set new password'}
      </Button>
    </form>
  );
}
