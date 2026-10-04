'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type SubmitEvent } from 'react';
import { Alert, Button, Field, Input, fieldAria } from '@/components/ui/primitives';
import { useSubmit } from '@/components/use-submit';
import { ApiError, api, tokenFromHash } from '@/lib/api-client';
import { ROLE_LABELS, roleSchema } from '@invoiceguard/shared/permissions';

const LINK =
  'font-medium text-emerald-700 underline underline-offset-4 hover:text-emerald-900 dark:text-emerald-400';
/** Survives the round trip through /login, which loses the URL fragment. */
const STORAGE_KEY = 'ig.inviteToken';

interface Preview {
  orgName: string;
  email: string;
  role: string;
  status: 'open' | 'expired' | 'accepted' | 'revoked';
}

function isPreview(value: unknown): value is Preview {
  return (
    typeof value === 'object' &&
    value !== null &&
    'orgName' in value &&
    'email' in value &&
    'role' in value &&
    'status' in value
  );
}

type Load =
  | { state: 'loading' }
  | { state: 'missing' }
  | { state: 'error'; message: string }
  | { state: 'ready'; token: string; preview: Preview };

export function InviteAccept({ signedInEmail }: { signedInEmail: string | null }) {
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [mode, setMode] = useState<'signup' | 'choose'>('choose');
  const { pending, error, fieldErrors, run } = useSubmit();

  useEffect(() => {
    let token = tokenFromHash(window.location.hash);
    try {
      if (token !== null) sessionStorage.setItem(STORAGE_KEY, token);
      else token = sessionStorage.getItem(STORAGE_KEY);
    } catch {
      // Storage can be unavailable (private mode); the fragment alone still works.
    }
    if (token === null) {
      setLoad({ state: 'missing' });
      return;
    }
    const found = token;
    api('/invites/preview', { body: { token: found } }).then(
      (preview) => {
        if (isPreview(preview)) setLoad({ state: 'ready', token: found, preview });
        else setLoad({ state: 'error', message: 'Could not read this invitation.' });
      },
      (err: unknown) => {
        setLoad({
          state: 'error',
          message: err instanceof ApiError ? err.message : 'Could not load this invitation.',
        });
      },
    );
  }, []);

  function done() {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignored: see above.
    }
    router.replace('/app');
    router.refresh();
  }

  if (load.state === 'loading')
    return <p className="text-sm text-slate-600 dark:text-slate-400">Loading invitation…</p>;
  if (load.state === 'missing') {
    return (
      <Alert variant="error">
        This invitation link is incomplete. Open it again from the email.
      </Alert>
    );
  }
  if (load.state === 'error') return <Alert variant="error">{load.message}</Alert>;

  const { token, preview } = load;
  if (preview.status !== 'open') {
    const reason = {
      expired: 'This invitation has expired. Ask an admin of the organization to invite you again.',
      accepted: 'This invitation has already been used.',
      revoked: 'This invitation was withdrawn. Ask an admin of the organization for a new one.',
    }[preview.status];
    return <Alert variant="error">{reason}</Alert>;
  }

  const summary = (
    <p className="text-sm">
      You are invited to join <strong>{preview.orgName}</strong> as{' '}
      <strong>{ROLE_LABELS[roleSchema.catch('viewer').parse(preview.role)]}</strong>. The invitation
      is for <strong>{preview.email}</strong>.
    </p>
  );

  if (signedInEmail !== null) {
    const matches = signedInEmail.toLowerCase() === preview.email.toLowerCase();
    return (
      <div className="flex flex-col gap-4">
        {summary}
        {error !== null && <Alert variant="error">{error}</Alert>}
        {matches ? (
          <Button
            disabled={pending}
            onClick={() =>
              void run(async () => {
                await api('/invites/accept', { body: { token } });
                done();
              })
            }
          >
            {pending ? 'Joining…' : `Join ${preview.orgName}`}
          </Button>
        ) : (
          <>
            <Alert>
              You are signed in as {signedInEmail}. Sign out, then open the invitation again and
              sign in as {preview.email}.
            </Alert>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() =>
                void run(async () => {
                  await api('/auth/logout');
                  router.refresh();
                })
              }
            >
              Sign out
            </Button>
          </>
        )}
      </div>
    );
  }

  async function onSignup(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const ok = await run(async () => {
      await api('/auth/signup', {
        body: { inviteToken: token, name: data.get('name'), password: data.get('password') },
      });
    });
    if (ok) done();
  }

  return (
    <div className="flex flex-col gap-4">
      {summary}
      {mode === 'choose' ? (
        <div className="flex flex-col gap-3">
          <Button
            onClick={() => {
              setMode('signup');
            }}
          >
            Create my account
          </Button>
          <Link href="/login?next=/invite" className={`${LINK} text-center text-sm`}>
            I already have an account: sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={(e) => void onSignup(e)} className="flex flex-col gap-4" noValidate>
          {error !== null && <Alert variant="error">{error}</Alert>}
          <Field id="invite-email" label="Email">
            <Input id="invite-email" value={preview.email} readOnly disabled />
          </Field>
          <Field id="name" label="Your name" error={fieldErrors.name}>
            <Input
              name="name"
              autoComplete="name"
              required
              {...fieldAria('name', fieldErrors.name)}
            />
          </Field>
          <Field
            id="password"
            label="Password"
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
          <Button type="submit" disabled={pending}>
            {pending ? 'Creating account…' : `Create account and join ${preview.orgName}`}
          </Button>
        </form>
      )}
    </div>
  );
}
