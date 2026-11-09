/**
 * The Odoo labour employee pass (#1510 L2, FR-OLH-003): one page of `hr.employee` per tick for an org that employs
 * `timesheets` under Odoo, riding the SAME resumable scan / `(write_date, id)` keyset / overlap / daily census machinery as
 * the O1 directory kinds (`runKind`, `runCensus`). Rows go to `apply_odoo_employees` (0860), which upserts the SHIPPED
 * `erp_employees` table and PROPOSES a PMO-user link on an exact active-profile email match — it never confirms one. The
 * cursor lives under `labour:employee` and moves only inside `apply_odoo_employees` / `finish_odoo_employee_census`.
 *
 * PMO never creates an Odoo employee (D6): the pass only reads. A model discovery did not find present and readable is
 * skipped (the connection is already degraded), never a failed tick.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import type { CapabilitySnapshot, ModelProbe } from '../../../pmo-portal/src/lib/adapterSeam/odoo/discovery.ts';
import { base, str, withAttrs, type DirectoryRow, type KindSpec } from '../../../pmo-portal/src/lib/adapterSeam/odoo/kinds.ts';
import { odooKindReaders, runCensus, runKind, type KindRunDeps } from '../../../pmo-portal/src/lib/adapterSeam/odoo/sweep.ts';

type Budget = { spend: () => boolean; left: () => boolean };

/** `hr.employee` as labour reads it: the fields are `LABOUR_MODELS['hr.employee']`, and `work_email` rides in `attrs`
 *  because the directory row shape has no email column. Company-scoped like every other company-scoped kind. */
export const LABOUR_EMPLOYEE_SPEC: KindSpec = {
  model: 'hr.employee',
  fields: ['name', 'work_email', 'active', 'write_date'],
  company: 'company_id',
  parse: (r) => withAttrs(base(r, r.name, null, false), { work_email: str(r.work_email) }),
};

async function rpc(sc: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await sc.rpc(fn, args);
  if (error) throw new Error(`${fn} failed`);
  return data;
}

/** The org employs `timesheets` under Odoo (0861's predicate). An unreadable answer is "no": the pass is an addition, and a
 *  store hiccup must never fail a tick that already mirrored the directory. */
export async function labourFeedEmployed(sc: SupabaseClient, orgId: string): Promise<boolean> {
  try {
    const { data, error } = await sc.rpc('org_employs_odoo_timesheets', { p_org: orgId });
    return !error && data === true;
  } catch {
    return false;
  }
}

/** A labour model the stored snapshot shows present, readable and complete. Anything else skips the pass (never degrades). */
export function labourReadable(capabilities: CapabilitySnapshot | undefined, model: string): boolean {
  const p = (capabilities as { labour?: Record<string, ModelProbe | undefined> } | undefined)?.labour?.[model];
  return p !== undefined && p.exists && p.read && p.fields_missing.length === 0;
}

async function readCursor(sc: SupabaseClient, orgId: string): Promise<string> {
  const { data, error } = await sc.from('external_sync_watermarks').select('watermark_cursor')
    .eq('org_id', orgId).eq('external_tier', 'odoo').eq('domain', 'labour:employee').maybeSingle();
  if (error) throw new Error('could not read the Odoo labour cursor');
  return (data?.watermark_cursor as string | undefined) ?? '';
}

/** One directory row → the `p_rows` element `apply_odoo_employees` parses (it re-validates every field, and skips a
 *  malformed row whole). */
const employeeRow = (row: DirectoryRow) => ({
  external_id: row.external_id,
  name: row.name,
  work_email: (row.attrs.work_email as string | null) ?? null,
  active: row.active,
  write_date: row.source_write_date,
});

export interface LabourEmployeePassOpts { pageSize?: number; censusPageSize?: number; now?: () => Date }

/** Feed pages until caught up or the budget is spent, then (when caught up) the daily census, which tombstones an employee
 *  Odoo no longer returns. Returns the rows skipped as unparseable (an unparseable row is never partly written). */
export async function runLabourEmployeePass(
  sc: SupabaseClient, orgId: string, call: OdooCall, companyId: number, budget: Budget, opts: LabourEmployeePassOpts = {},
): Promise<{ skipped: number; applied: number }> {
  // The census reads ids page by page and only finishes once; `runCensus` hands the ids to `censusSeen` as it goes, so the
  // set is collected here and sent with the finish — the same in-memory progress `runCensus` itself keeps.
  const seen: string[] = [];
  const deps: KindRunDeps = {
    ...odooKindReaders(call, LABOUR_EMPLOYEE_SPEC, companyId),
    apply: async (rows, cursor) => {
      await rpc(sc, 'apply_odoo_employees', { p_org_id: orgId, p_rows: rows.map(employeeRow), p_cursor: cursor });
    },
    censusSeen: (_run, ids) => { seen.push(...ids); return Promise.resolve(); },
    censusFinish: async (run, cursor) => {
      await rpc(sc, 'finish_odoo_employee_census', { p_org_id: orgId, p_run: run, p_seen: seen, p_cursor: cursor });
    },
    budget,
    now: opts.now ?? (() => new Date()),
    ...(opts.pageSize ? { pageSize: opts.pageSize } : {}),
    ...(opts.censusPageSize ? { censusPageSize: opts.censusPageSize } : {}),
  };
  const run = await runKind(LABOUR_EMPLOYEE_SPEC, await readCursor(sc, orgId), deps);
  if (run.done) await runCensus(await readCursor(sc, orgId), deps);
  return { skipped: run.skipped, applied: run.applied.length };
}
