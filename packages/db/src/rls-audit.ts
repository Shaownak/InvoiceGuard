/**
 * Catalog inspection behind the RLS enumeration test (ARCHITECTURE.md section 5). It reads
 * pg_catalog only, so it can inspect a live database or a transaction holding a probe table.
 */

import { z } from 'zod';

export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

async function select<S extends z.ZodType>(
  db: Queryable,
  row: S,
  text: string,
  values: unknown[],
): Promise<z.infer<S>[]> {
  const res = await db.query(text, values);
  return z.array(row).parse(res.rows);
}

export interface RlsProblem {
  object: string;
  problem: string;
}

/**
 * Policies on tenant tables that may scope by user instead of org. Each entry is reviewed:
 * `memberships_own_select` lets a user list their own memberships in other orgs.
 */
export const USER_SCOPED_TENANT_POLICIES: readonly string[] = [
  'memberships.memberships_own_select',
];

/** SECURITY DEFINER functions reviewed for M1 (ADR-0015). Anything else is a finding. */
export const REVIEWED_DEFINER_FUNCTIONS: readonly string[] = [
  'auth_consume_token',
  'auth_find_user_by_email',
  'auth_register_user',
  'auth_session_lookup',
  'create_organization',
  'invite_lookup',
];

const ORG_CONTEXT = 'app_org_id()';
const USER_CONTEXT = 'app_user_id()';

const tableRow = z.object({ table: z.string(), rls: z.boolean(), has_org_id: z.boolean() });
const policyRow = z.object({
  table: z.string(),
  policy: z.string(),
  cmd: z.string(),
  qual: z.string().nullable(),
  with_check: z.string().nullable(),
});

export async function findRlsProblems(db: Queryable, schema = 'public'): Promise<RlsProblem[]> {
  const problems: RlsProblem[] = [];

  const tables = await select(
    db,
    tableRow,
    `SELECT c.relname AS table,
            c.relrowsecurity AS rls,
            EXISTS (
              SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = c.oid AND a.attname = 'org_id' AND NOT a.attisdropped
            ) AS has_org_id
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND c.relkind IN ('r', 'p')
     ORDER BY 1`,
    [schema],
  );
  const policies = await select(
    db,
    policyRow,
    `SELECT tablename AS table, policyname AS policy, cmd, qual, with_check
     FROM pg_policies WHERE schemaname = $1 ORDER BY 1, 2`,
    [schema],
  );

  for (const t of tables) {
    if (!t.rls) problems.push({ object: t.table, problem: 'row-level security is not enabled' });
    const own = policies.filter((p) => p.table === t.table);
    if (own.length === 0) {
      problems.push({ object: t.table, problem: 'has no policy' });
      continue;
    }
    for (const p of own) {
      const name = `${t.table}.${p.policy}`;
      const exprs = [p.qual, p.with_check].filter((e): e is string => e !== null);
      if (exprs.length === 0) {
        problems.push({ object: name, problem: 'policy has no USING or WITH CHECK expression' });
        continue;
      }
      if (t.has_org_id && !USER_SCOPED_TENANT_POLICIES.includes(name)) {
        if (!exprs.every((e) => e.includes(ORG_CONTEXT))) {
          problems.push({ object: name, problem: `tenant policy does not check ${ORG_CONTEXT}` });
        }
      } else if (t.has_org_id) {
        if (p.cmd !== 'SELECT' || !exprs.every((e) => e.includes(USER_CONTEXT))) {
          problems.push({
            object: name,
            problem: `user-scoped tenant policy must be SELECT-only and check ${USER_CONTEXT}`,
          });
        }
      } else if (!exprs.every((e) => e.includes(ORG_CONTEXT) || e.includes(USER_CONTEXT))) {
        problems.push({ object: name, problem: 'policy is not bound to an org or user context' });
      }
    }
  }

  // Views run with their owner's rights unless security_invoker is set, which would let the
  // app role read through RLS. Materialized views cannot have RLS at all.
  const views = await select(
    db,
    z.object({ view: z.string(), kind: z.string(), invoker: z.boolean() }),
    `SELECT c.relname AS view, c.relkind::text AS kind,
            coalesce('security_invoker=true' = ANY (c.reloptions), false) AS invoker
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND c.relkind IN ('v', 'm')`,
    [schema],
  );
  for (const v of views) {
    if (v.kind === 'm') problems.push({ object: v.view, problem: 'materialized views bypass RLS' });
    else if (!v.invoker) problems.push({ object: v.view, problem: 'view lacks security_invoker' });
  }

  const definers = await select(
    db,
    z.object({ fn: z.string() }),
    `SELECT p.proname AS fn
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = $1 AND p.prosecdef`,
    [schema],
  );
  for (const d of definers) {
    if (!REVIEWED_DEFINER_FUNCTIONS.includes(d.fn)) {
      problems.push({ object: `${d.fn}()`, problem: 'unreviewed SECURITY DEFINER function' });
    }
  }

  return problems;
}

/** Tables in `schema` with an `org_id` column (the tenant tables). */
export async function listTenantTables(db: Queryable, schema = 'public'): Promise<string[]> {
  const rows = await select(
    db,
    z.object({ table: z.string() }),
    `SELECT c.relname AS table
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'org_id' AND NOT a.attisdropped
     WHERE n.nspname = $1 AND c.relkind IN ('r', 'p')
     ORDER BY 1`,
    [schema],
  );
  return rows.map((r) => r.table);
}
