'use client';

import { useRouter } from 'next/navigation';
import { useState, type SubmitEvent } from 'react';
import {
  memberChangeRefusal,
  ROLE_LABELS,
  ROLES,
  roleSchema,
  type Role,
} from '@invoiceguard/shared/permissions';
import { Alert, Button, Field, Input, Select, fieldAria } from '@/components/ui/primitives';
import { useSubmit } from '@/components/use-submit';
import { api } from '@/lib/api-client';

export interface MemberView {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
}

export interface InviteView {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
}

interface Props {
  members: MemberView[];
  invites: InviteView[] | null;
  actorRole: Role;
  actorUserId: string;
}

/**
 * Members and invitations for the active org. Controls are disabled with the same rules the
 * API enforces (`memberChangeRefusal`), so the UI never offers a change the server refuses.
 */
export function MembersPanel({ members, invites, actorRole, actorUserId }: Props) {
  const router = useRouter();
  const { pending, error, run } = useSubmit();
  const [notice, setNotice] = useState<string | null>(null);
  const owners = members.filter((m) => m.role === 'owner').length;
  const canManage = invites !== null;

  function act(action: () => Promise<void>, success: string) {
    setNotice(null);
    void run(action).then((ok) => {
      if (ok) {
        setNotice(success);
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-8">
      {error !== null && <Alert variant="error">{error}</Alert>}
      {notice !== null && <Alert variant="success">{notice}</Alert>}

      <section aria-labelledby="members-heading" className="flex flex-col gap-3">
        <h2 id="members-heading" className="text-lg font-semibold">
          Members ({members.length})
        </h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  Name
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Email
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Role
                </th>
                {canManage && (
                  <th scope="col" className="px-4 py-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const removeRefusal = memberChangeRefusal(
                  actorRole,
                  { kind: 'remove', role: m.role },
                  owners,
                );
                const you = m.userId === actorUserId;
                return (
                  <tr
                    key={m.membershipId}
                    className="border-t border-slate-200 dark:border-slate-800"
                  >
                    <td className="px-4 py-2">
                      {m.name}
                      {you && <span className="ml-1 text-slate-500">(you)</span>}
                    </td>
                    <td className="px-4 py-2">{m.email}</td>
                    <td className="px-4 py-2">
                      {canManage ? (
                        <Select
                          aria-label={`Role for ${m.name}`}
                          value={m.role}
                          disabled={pending}
                          onChange={(event) => {
                            const role = roleSchema.parse(event.target.value);
                            act(async () => {
                              await api(`/members/${m.membershipId}`, {
                                method: 'PATCH',
                                body: { role },
                              });
                            }, `${m.name} is now ${ROLE_LABELS[role]}.`);
                          }}
                        >
                          {ROLES.map((role) => (
                            <option
                              key={role}
                              value={role}
                              disabled={
                                role !== m.role &&
                                memberChangeRefusal(
                                  actorRole,
                                  { kind: 'change_role', from: m.role, to: role },
                                  owners,
                                ) !== null
                              }
                            >
                              {ROLE_LABELS[role]}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        ROLE_LABELS[m.role]
                      )}
                    </td>
                    {canManage && (
                      <td className="px-4 py-2 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending || removeRefusal !== null}
                          title={removeRefusal?.message}
                          aria-label={`Remove ${m.name}`}
                          onClick={() => {
                            if (!window.confirm(`Remove ${m.name} from this organization?`)) return;
                            act(async () => {
                              await api(`/members/${m.membershipId}`, { method: 'DELETE' });
                            }, `${m.name} was removed.`);
                          }}
                        >
                          Remove
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {canManage && (
        <>
          <InviteForm
            actorRole={actorRole}
            disabled={pending}
            onInvite={(email, role) => {
              act(async () => {
                await api('/invites', { body: { email, role } });
              }, `Invitation sent to ${email}.`);
            }}
          />
          <section aria-labelledby="invites-heading" className="flex flex-col gap-3">
            <h2 id="invites-heading" className="text-lg font-semibold">
              Pending invitations
            </h2>
            {invites.length === 0 ? (
              <p className="text-sm text-slate-600 dark:text-slate-400">
                No pending invitations. Invite a colleague above.
              </p>
            ) : (
              <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                {invites.map((invite) => {
                  const expired = new Date(invite.expiresAt).getTime() <= Date.now();
                  return (
                    <li
                      key={invite.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm"
                    >
                      <span>
                        {invite.email} · {ROLE_LABELS[invite.role]} ·{' '}
                        {expired ? (
                          <span className="text-red-700 dark:text-red-400">
                            expired, invite again to resend
                          </span>
                        ) : (
                          `expires ${new Date(invite.expiresAt).toLocaleDateString()}`
                        )}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        aria-label={`Withdraw invitation for ${invite.email}`}
                        onClick={() => {
                          act(async () => {
                            await api(`/invites/${invite.id}`, { method: 'DELETE' });
                          }, `Invitation for ${invite.email} withdrawn.`);
                        }}
                      >
                        Withdraw
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function InviteForm({
  actorRole,
  disabled,
  onInvite,
}: {
  actorRole: Role;
  disabled: boolean;
  onInvite: (email: string, role: Role) => void;
}) {
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const invitable = ROLES.filter(
    (role) => memberChangeRefusal(actorRole, { kind: 'invite', role }, Infinity) === null,
  );

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const rawEmail = data.get('email');
    const email = typeof rawEmail === 'string' ? rawEmail.trim() : '';
    const role = roleSchema.catch('viewer').parse(data.get('role'));
    if (!email.includes('@')) {
      setEmailError('Enter a valid email address');
      return;
    }
    setEmailError(undefined);
    onInvite(email, role);
    form.reset();
  }

  return (
    <section aria-labelledby="invite-heading" className="flex flex-col gap-3">
      <h2 id="invite-heading" className="text-lg font-semibold">
        Invite a colleague
      </h2>
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3" noValidate>
        <div className="min-w-64 flex-1">
          <Field id="invite-email" label="Email" error={emailError}>
            <Input
              name="email"
              type="email"
              autoComplete="off"
              required
              {...fieldAria('invite-email', emailError)}
            />
          </Field>
        </div>
        <Field id="invite-role" label="Role">
          <Select id="invite-role" name="role" defaultValue="viewer">
            {invitable.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" disabled={disabled}>
          Send invitation
        </Button>
      </form>
      <p className="text-xs text-slate-600 dark:text-slate-400">Invitations expire after 7 days.</p>
    </section>
  );
}
