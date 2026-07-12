import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';

/**
 * erp_snapshots READ-ONLY DAL (Slice 7 task 7.7, ADR-0048). Reads the caller's own-org accounting
 * snapshot rows over `erp_actuals_snapshot` / `erp_ap_aging_snapshot` / `erp_ar_aging_snapshot`.
 * RLS (`org_id = auth_org_id()`) scopes every read — no `org_id` filter is sent by the client. There
 * is NO write path here by design — snapshots are machine-written by the sweep (slice 8), never a
 * client-side writer. The current scope (single as_of) is returned: snapshot-replace keeps exactly
 * one snapshot_id per scope, so every own-org row shares the latest coherent snapshot.
 */

export interface ErpActualsSnapshotRow {
  projectId: string | null;
  costCenter: string | null;
  account: string | null;
  fiscalYear: string | null;
  debit: number | null;
  credit: number | null;
  net: number | null;
  asOf: string;
  sourceReport: string;
  snapshotId: string;
}

export interface ErpAgingSnapshotRow {
  party: string | null;
  partyType: string | null;
  currency: string | null;
  totalOutstanding: number | null;
  current: number | null;
  bucket0to30: number | null;
  bucket31to60: number | null;
  bucket61to90: number | null;
  bucketOver90: number | null;
  rangeLabels: Record<string, string> | null;
  reportDate: string | null;
  ageingBasedOn: string | null;
  asOf: string;
  sourceReport: string | null;
  reportVersion: string | null;
  snapshotId: string;
}

interface ActualsDb {
  project_id: string | null;
  cost_center: string | null;
  account: string | null;
  fiscal_year: string | null;
  debit: number | null;
  credit: number | null;
  net: number | null;
  as_of: string;
  source_report: string;
  snapshot_id: string;
}

interface AgingDb {
  party: string | null;
  party_type: string | null;
  currency: string | null;
  total_outstanding: number | null;
  current: number | null;
  b_0_30: number | null;
  b_31_60: number | null;
  b_61_90: number | null;
  b_90_plus: number | null;
  range_labels: Record<string, string> | null;
  report_date: string | null;
  ageing_based_on: string | null;
  as_of: string;
  source_report: string | null;
  report_version: string | null;
  snapshot_id: string;
}

/**
 * task FIX-7 (Quality MINOR 5) — the latest-snapshot_id filter hardening. Snapshot-replace (delete
 * old scope rows, then insert new) is TWO round-trips, not one transaction (`actualsSnapshot.ts`/
 * `agingSnapshot.ts`'s comment on the pattern). A concurrent double-sweep can race the delete of one
 * pass against the insert of another and leave rows from TWO snapshot_ids in the table at once. Rather
 * than trust "snapshot-replace keeps exactly one snapshot_id per scope" blindly, filter the read to
 * only the MOST RECENT snapshot_id — the first row's, since the query already orders `created_at`
 * desc — so a stale generation never mixes into what renders.
 */
function latestSnapshotOnly<T extends { snapshot_id: string }>(rows: T[]): T[] {
  if (rows.length === 0) return rows;
  const latestId = rows[0].snapshot_id;
  return rows.filter((r) => r.snapshot_id === latestId);
}

function toActualsRow(db: ActualsDb): ErpActualsSnapshotRow {
  return {
    projectId: db.project_id,
    costCenter: db.cost_center,
    account: db.account,
    fiscalYear: db.fiscal_year,
    debit: db.debit,
    credit: db.credit,
    net: db.net,
    asOf: db.as_of,
    sourceReport: db.source_report,
    snapshotId: db.snapshot_id,
  };
}

function toAgingRow(db: AgingDb): ErpAgingSnapshotRow {
  return {
    party: db.party,
    partyType: db.party_type,
    currency: db.currency,
    totalOutstanding: db.total_outstanding,
    current: db.current,
    bucket0to30: db.b_0_30,
    bucket31to60: db.b_31_60,
    bucket61to90: db.b_61_90,
    bucketOver90: db.b_90_plus,
    rangeLabels: db.range_labels,
    reportDate: db.report_date,
    ageingBasedOn: db.ageing_based_on,
    asOf: db.as_of,
    sourceReport: db.source_report,
    reportVersion: db.report_version,
    snapshotId: db.snapshot_id,
  };
}

const ACTUALS_COLS = 'project_id,cost_center,account,fiscal_year,debit,credit,net,as_of,source_report,snapshot_id';
const AGING_COLS = 'party,party_type,currency,total_outstanding,current,b_0_30,b_31_60,b_61_90,b_90_plus,range_labels,report_date,ageing_based_on,as_of,source_report,report_version,snapshot_id';

/** The slice-7 snapshot tables are added by migration 0100 but not yet in the generated
 *  `database.types.ts` (which lags the P2 migrations app-wide). Cast the typed client to a loose
 *  shape for these reads so the strict table-typing does not reject the query (the cast is confined
 *  to this read-only DAL; RLS still scopes every read). */
interface LooseSnapshotQuery {
  order(column: string, opts?: { ascending?: boolean }): Promise<{ data: unknown[] | null; error: { message: string; code?: string } | null }>;
}
const loose = supabase as unknown as { from(table: string): { select(columns: string): LooseSnapshotQuery } };

/** Read the caller's own-org actuals snapshot (current scope). RLS-scoped; empty when no refresh has run. */
export async function listActualsSnapshot(): Promise<ErpActualsSnapshotRow[]> {
  const { data, error } = await loose.from('erp_actuals_snapshot').select(ACTUALS_COLS).order('created_at', { ascending: false });
  if (error) throw new AppError(error.message, error.code);
  return latestSnapshotOnly((data ?? []) as unknown as ActualsDb[]).map(toActualsRow);
}

/** Read the caller's own-org AP aging snapshot (current scope). RLS-scoped; empty when no refresh has run. */
export async function listApAgingSnapshot(): Promise<ErpAgingSnapshotRow[]> {
  const { data, error } = await loose.from('erp_ap_aging_snapshot').select(AGING_COLS).order('created_at', { ascending: false });
  if (error) throw new AppError(error.message, error.code);
  return latestSnapshotOnly((data ?? []) as unknown as AgingDb[]).map(toAgingRow);
}

/** Read the caller's own-org AR aging snapshot (current scope). RLS-scoped; empty when no refresh has run. */
export async function listArAgingSnapshot(): Promise<ErpAgingSnapshotRow[]> {
  const { data, error } = await loose.from('erp_ar_aging_snapshot').select(AGING_COLS).order('created_at', { ascending: false });
  if (error) throw new AppError(error.message, error.code);
  return latestSnapshotOnly((data ?? []) as unknown as AgingDb[]).map(toAgingRow);
}
