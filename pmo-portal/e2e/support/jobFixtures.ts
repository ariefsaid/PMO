// Shared generic fixtures for the contractor job journeys (JOB-*.spec.ts). Service-role inserts into the seed org with a unique
// per-run name; `cleanup` deletes only what this run created (children first). Used by self-isolated specs only.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { requireServiceRoleKey } from '../helpers';
import { requireMatchingLocalSupabaseUrls } from '../../src/lib/testing/localSupabaseUrl';

export const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
export const PM_ID = '00000000-0000-0000-0000-0000000000a2';

export function serviceClient(who: string): SupabaseClient {
  const key = requireServiceRoleKey();
  if (!key) throw new Error(`${who} needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh`);
  const env = loadEnv('development', process.cwd(), 'VITE_');
  const url = requireMatchingLocalSupabaseUrls(process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_URL ?? env.VITE_SUPABASE_URL);
  return createClient(url, key, { auth: { persistSession: false } });
}

type R<T> = { data: T; error: { message: string } | null };
/** Unwrap a supabase result or throw naming the step. */
export function need<T>(step: string, r: R<T>): NonNullable<T> {
  if (r.error) throw new Error(`${step}: ${r.error.message}`);
  if (r.data === null || r.data === undefined) throw new Error(`${step}: no row returned`);
  return r.data as NonNullable<T>;
}
export function ok(step: string, r: { error: { message: string } | null }): void {
  if (r.error) throw new Error(`${step}: ${r.error.message}`);
}

export const runId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** A USD client project managed by the seed PM, with `n` issued work orders. */
export async function projectWithWorkOrders(admin: SupabaseClient, run: string, titles: string[], opts: { orderValue?: number } = {}) {
  const project = need('project', await admin.from('projects').insert({
    org_id: ORG_ID, name: `${run} project`, status: 'Ongoing Project', currency: 'USD', project_manager_id: PM_ID,
  }).select('id').single());
  const workOrders: { id: string; number: string; title: string }[] = [];
  for (const [i, title] of titles.entries()) {
    const id = crypto.randomUUID();
    const number = `WO-${run}-${i + 1}`;
    ok('work order', await admin.from('work_orders').insert({
      id, org_id: ORG_ID, project_id: project.id, title: `${run} ${title}`, status: 'Issued', wo_number: number,
      issued_at: new Date().toISOString(), order_value: opts.orderValue ?? 100_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD',
    }));
    workOrders.push({ id, number, title: `${run} ${title}` });
  }
  return { projectId: project.id as string, workOrders };
}

/** Delete rows by table/column in order, collecting failures so every step runs. */
export async function cleanupAll(admin: SupabaseClient, steps: [table: string, column: string, values: string[]][]): Promise<void> {
  const failures: string[] = [];
  for (const [table, column, values] of steps) {
    if (values.length === 0) continue;
    const r = await admin.from(table).delete().in(column, values);
    if (r.error) failures.push(`${table}: ${r.error.message}`);
  }
  if (failures.length) throw new Error(`cleanup failed: ${failures.join('; ')}`);
}
