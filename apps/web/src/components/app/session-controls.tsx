'use client';

import { useRouter } from 'next/navigation';
import { useId, type SubmitEvent } from 'react';
import { Alert, Button, Field, Input, Select, fieldAria } from '@/components/ui/primitives';
import { useSubmit } from '@/components/use-submit';
import { api } from '@/lib/api-client';

export interface OrgOption {
  id: string;
  name: string;
}

/** FR-ORG-1: switch the active organization; the page re-renders with the new org. */
export function OrgSwitcher({
  orgs,
  activeOrgId,
}: {
  orgs: OrgOption[];
  activeOrgId: string | null;
}) {
  const router = useRouter();
  const id = useId();
  const { pending, error, run } = useSubmit();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm text-slate-600 dark:text-slate-400">
        Organization
      </label>
      <Select
        id={id}
        value={activeOrgId ?? ''}
        disabled={pending}
        onChange={(event) => {
          const target = event.target.value;
          if (target === '' || target === activeOrgId) return;
          void run(async () => {
            await api(`/orgs/${target}/switch`);
            router.push('/app');
            router.refresh();
          });
        }}
      >
        {activeOrgId === null && <option value="">Select…</option>}
        {orgs.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name}
          </option>
        ))}
      </Select>
      {error !== null && (
        <span role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </span>
      )}
    </div>
  );
}

export function SignOutButton() {
  const router = useRouter();
  const { pending, run } = useSubmit();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        void run(async () => {
          await api('/auth/logout');
          router.replace('/login');
          router.refresh();
        })
      }
    >
      Sign out
    </Button>
  );
}

export function CreateOrgForm() {
  const router = useRouter();
  const { pending, error, fieldErrors, run } = useSubmit();

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = new FormData(event.currentTarget).get('name');
    const ok = await run(async () => {
      await api('/orgs', { body: { name } });
    });
    if (ok) {
      router.push('/app');
      router.refresh();
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="flex max-w-md flex-col gap-4" noValidate>
      {error !== null && <Alert variant="error">{error}</Alert>}
      <Field id="org-name" label="Organization name" error={fieldErrors.name}>
        <Input
          name="name"
          autoComplete="organization"
          required
          {...fieldAria('org-name', fieldErrors.name)}
        />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? 'Creating…' : 'Create organization'}
      </Button>
    </form>
  );
}
