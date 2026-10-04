import Link from 'next/link';
import type { ReactNode } from 'react';
import { OrgSwitcher, SignOutButton } from '@/components/app/session-controls';
import { requirePageSession } from '@/server/page-session';
import { getRuntime } from '@/server/runtime';

const NAV_LINK =
  'rounded px-2 py-1 text-sm text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:text-slate-300 dark:hover:bg-slate-800';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requirePageSession();
  const orgs = await getRuntime().services.orgs.listMyOrganizations(session.user.id);
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 dark:border-slate-800">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-3">
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/app" className="font-bold tracking-tight">
              InvoiceGuard
            </Link>
            <nav aria-label="Main" className="flex gap-1">
              <Link href="/app" className={NAV_LINK}>
                Overview
              </Link>
              {session.org !== null && (
                <Link href="/app/settings/members" className={NAV_LINK}>
                  Members
                </Link>
              )}
              <Link href="/app/orgs/new" className={NAV_LINK}>
                New organization
              </Link>
            </nav>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {orgs.length > 0 && (
              <OrgSwitcher
                orgs={orgs.map((o) => ({ id: o.orgId, name: o.name }))}
                activeOrgId={session.org?.id ?? null}
              />
            )}
            <span className="text-sm text-slate-600 dark:text-slate-400">{session.user.name}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
