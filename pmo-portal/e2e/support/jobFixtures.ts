// Shared generic fixtures for the contractor job journeys (JOB-*.spec.ts). Service-role inserts into the seed org with a unique
// per-run name; `cleanup` deletes only what this run created (children first). Used by self-isolated specs only.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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

const FINANCE_ID = '00000000-0000-0000-0000-0000000000a3';
/** Superuser SQL against the local DB, for deletes the app forbids by design (approved usage, append-only rows). Scoped by the caller. */
export function sqlAsOwner(sql: string): void {
  execFileSync('docker', ['exec', '-i', 'supabase_db_pmo-portal', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1'], {
    input: `begin; set local session_replication_role = replica; ${sql} commit;`, encoding: 'utf8',
  });
}

export interface EquipmentCostFixture { assetId: string; mapId: string | null; accountId: string | null }
/** A machine at `rate` an hour, with approved usage hours per work order, costed as hire (an Active budget carries the Equipment category; `mapId` is that budget version). */
export async function equipmentCost(admin: SupabaseClient, run: string, projectId: string, rate: number, usage: { woId: string; day: string; hours: number }[]): Promise<EquipmentCostFixture> {
  const assetId = need('asset', await admin.from('equipment_assets').insert({ org_id: ORG_ID, code: run, name: run, default_unit: 'hours' }).select('id').single()).id as string;
  // The Equipment category must exist on the project's finances: an Active budget with one Equipment line does that.
  const version = need('budget', await admin.from('budget_versions').insert({ org_id: ORG_ID, project_id: projectId, name: run, version: 1, status: 'Draft' }).select('id').single());
  ok('budget line', await admin.from('budget_line_items').insert({ org_id: ORG_ID, budget_version_id: version.id, category: 'Equipment', budgeted_amount: 10_000 }));
  ok('activate', await admin.from('budget_versions').update({ status: 'Active' }).eq('id', version.id));
  const mapId = version.id as string; const accountId: string | null = null;
  ok('rate', await admin.from('equipment_costing_settings').insert({ org_id: ORG_ID, asset_id: assetId, setting_key: crypto.randomUUID(), version: 1, basis: 'hire_rate', work_rate: rate, rate_unit: 'hours', charge_category: 'Equipment', effective_from: '2026-01-01' }));
  for (const u of usage) {
    ok('usage', await admin.from('equipment_usage_entries').insert({
      org_id: ORG_ID, asset_id: assetId, project_id: projectId, work_date: u.day, quantity: u.hours, unit: 'hours', status: 'Approved',
      author_id: PM_ID, approver_id: FINANCE_ID, approved_at: new Date().toISOString(), work_order_id: u.woId,
    }));
  }
  return { assetId, mapId, accountId };
}
export async function cleanupEquipment(admin: SupabaseClient, fx: EquipmentCostFixture | undefined): Promise<void> {
  if (!fx) return;
  sqlAsOwner(`delete from public.equipment_usage_entries where asset_id = '${fx.assetId}'; delete from public.equipment_costing_settings where asset_id = '${fx.assetId}'; delete from public.equipment_assets where id = '${fx.assetId}';`);
  if (fx.mapId) sqlAsOwner(`delete from public.budget_line_items where budget_version_id = '${fx.mapId}'; delete from public.budget_versions where id = '${fx.mapId}';`);
  if (fx.accountId) ok('account', await admin.from('erp_account_mirror').delete().eq('id', fx.accountId));
}

/** A project no other journey reads; delete it (and its children) in afterEach. */
export async function ownProject(admin: SupabaseClient, name: string): Promise<string> {
  const id = randomUUID();
  ok('project', await admin.from('projects').insert({
    id, org_id: ORG_ID, name, status: 'Ongoing Project', currency: 'USD', contract_value: 0, tax_treatment: 'exclusive', tax_amount: 0,
  }));
  return id;
}

export async function profileId(admin: SupabaseClient, email: string): Promise<string> {
  const row = need('profile', await admin.from('profiles').select('id').eq('email', email).single());
  return row.id as string;
}

export async function dropProject(admin: SupabaseClient, projectId: string, tables: string[] = ['tasks']): Promise<void> {
  for (const table of tables) ok(`${table} cleanup`, await admin.from(table).delete().eq('project_id', projectId));
  ok('record changes cleanup', await admin.from('record_changes').delete().eq('entity_id', projectId));
  ok('project cleanup', await admin.from('projects').delete().eq('id', projectId));
}

export const uniq = () => randomUUID().slice(0, 8);
