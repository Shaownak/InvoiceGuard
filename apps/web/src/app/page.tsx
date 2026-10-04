import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-6 py-16">
      <p className="text-sm font-semibold tracking-wide text-emerald-700 uppercase dark:text-emerald-400">
        Pre-payment invoice audit
      </p>
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">InvoiceGuard</h1>
      <p className="text-lg text-slate-700 dark:text-slate-300">
        Upload supplier invoices, match them to purchase orders and receipts, and review potential
        duplicates, overbilling, and bank detail changes before anything is paid.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/signup"
          className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-500"
        >
          Create account
        </Link>
        <Link
          href="/login"
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          Sign in
        </Link>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Service status:{' '}
        <a
          href="/api/health"
          className="font-medium text-emerald-700 underline underline-offset-4 hover:text-emerald-900 focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-300"
        >
          /api/health
        </a>
      </p>
    </main>
  );
}
