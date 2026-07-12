/**
 * erpnext/actualsSnapshot.ts (task 7.3, AC-ENA-060, ADR-0048): refreshActuals — sums MIRRORED
 * `erp_gl_entry_mirror` rows into `erp_actuals_snapshot`. PMO may SUM mirrored ledger rows (ERP
 * truth); it may NEVER invent an accounting figure or read `procurement_invoices` (the FR-ENA-162 /
 * ADR-0048 prohibition). Sums are per (cost_center, account, fiscal_year); a refresh mints a new
 * `snapshot_id`, deletes the prior-scope rows, and inserts the summed rows stamping
 * `source_report='GL Entry'` + `as_of`.
 *
 * Read-source = the mirrored read-model ONLY (never a live ERP fetch) — the slice-8 sweep feed
 * (8.x) keeps `erp_gl_entry_mirror` fresh; this module is the slice-7 consumer. Importable by Vitest
 * (app) and by the slice-8 sweep edge fn (Deno) — relative imports only, structural service-client
 * seam (no supabase-js nominal dep).
 */
import { AppError } from '../../appError.ts';

/** Structural service-role client seam (matches supabase-js): `.from(t).select(c).eq().eq()` (thenable),
 *  `.from(t).delete().eq().eq()` (thenable), `.from(t).insert([...])`. Real supabase-js is not
 *  nominally assignable (thenable PostgrestFilterBuilder) — callers cast `as never` at the boundary. */
export interface SnapshotServiceClient {
  from(table: string): SnapshotTable;
}
export interface SnapshotEqChain {
  eq(column: string, value: string | number | boolean | null): SnapshotEqChain;
}
export interface SnapshotSelectBuilder extends SnapshotEqChain, PromiseLike<{ data: unknown[] | null; error: { message: string; code?: string } | null }> {}
export interface SnapshotDeleteBuilder extends SnapshotEqChain, PromiseLike<{ error: { message: string; code?: string } | null }> {}
export interface SnapshotTable {
  select(columns: string): SnapshotSelectBuilder;
  delete(): SnapshotDeleteBuilder;
  insert(rows: unknown[]): Promise<{ error: { message: string; code?: string } | null }>;
}

export interface ActualsScope {
  /** Optional PMO project stamp for the snapshot rows (org-level refresh = omit/null). */
  projectId?: string | null;
  /** Optional fiscal-year narrow on the mirror read. */
  fiscalYear?: string;
}

interface MirrorRow {
  cost_center: string | null;
  account: string | null;
  fiscal_year: string | null;
  debit: number | string | null;
  credit: number | string | null;
}

interface SumBucket {
  costCenter: string | null;
  account: string | null;
  fiscalYear: string | null;
  debit: number;
  credit: number;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

function toNumber(v: number | string | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function groupKey(costCenter: string | null, account: string | null, fiscalYear: string | null): string {
  return `${costCenter ?? ''}\u0000${account ?? ''}\u0000${fiscalYear ?? ''}`;
}

/**
 * Refresh the actuals snapshot for ONE org's scope by summing its mirrored GL rows. Steps:
 *   (1) SELECT mirrored erp_gl_entry_mirror rows (org-scoped; is_cancelled=false; optional fiscal-year narrow);
 *   (2) SUM debit/credit per (cost_center, account, fiscal_year); net = debit − credit;
 *   (3) new snapshot_id → DELETE prior-scope erp_actuals_snapshot rows → INSERT the summed rows.
 * ADR-0048: this is ERP truth (sums of mirrored rows), never a PMO-authored figure; procurement_invoices
 * is never touched on any path.
 */
export async function refreshActuals(
  serviceClient: SnapshotServiceClient,
  orgId: string,
  scope: ActualsScope,
): Promise<void> {
  // (1) Read the mirrored GL read-model (NEVER procurement_invoices).
  let selectBuilder = serviceClient.from('erp_gl_entry_mirror').select('cost_center,account,fiscal_year,debit,credit').eq('org_id', orgId).eq('is_cancelled', false);
  if (scope.fiscalYear !== undefined) selectBuilder = selectBuilder.eq('fiscal_year', scope.fiscalYear);
  const { data: rawRows, error: readErr } = await selectBuilder;
  if (readErr) throw new AppError(readErr.message, readErr.code);
  const rows = (rawRows ?? []) as MirrorRow[];

  // (2) Sum per (cost_center, account, fiscal_year).
  const buckets = new Map<string, SumBucket>();
  for (const row of rows) {
    const key = groupKey(row.cost_center, row.account, row.fiscal_year);
    let b = buckets.get(key);
    if (!b) {
      b = { costCenter: row.cost_center, account: row.account, fiscalYear: row.fiscal_year, debit: 0, credit: 0 };
      buckets.set(key, b);
    }
    b.debit += toNumber(row.debit);
    b.credit += toNumber(row.credit);
  }

  const snapshotId = crypto.randomUUID();
  const asOf = new Date().toISOString();
  const newRows = Array.from(buckets.values()).map((b) => ({
    org_id: orgId,
    project_id: scope.projectId ?? null,
    cost_center: b.costCenter,
    account: b.account,
    fiscal_year: b.fiscalYear,
    debit: round2(b.debit),
    credit: round2(b.credit),
    net: round2(b.debit - b.credit),
    as_of: asOf,
    source_report: 'GL Entry',
    snapshot_id: snapshotId,
  }));

  // (3) Snapshot-replace: delete the prior scope, then insert the new (single snapshot_id / single as_of).
  let deleteBuilder = serviceClient.from('erp_actuals_snapshot').delete().eq('org_id', orgId);
  if (scope.projectId !== undefined) deleteBuilder = deleteBuilder.eq('project_id', scope.projectId ?? null);
  const { error: delErr } = await deleteBuilder;
  if (delErr) throw new AppError(delErr.message, delErr.code);

  const { error: insErr } = await serviceClient.from('erp_actuals_snapshot').insert(newRows);
  if (insErr) throw new AppError(insErr.message, insErr.code);
}
