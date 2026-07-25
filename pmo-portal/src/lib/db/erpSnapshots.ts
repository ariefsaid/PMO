import { supabase } from '@/src/lib/supabase/client';
import { fetchAllRowsByKeyset } from '../pagedRead.ts';
import { AppError } from '@/src/lib/appError';

/**
 * erp_snapshots READ-ONLY DAL (Slice 7 task 7.7, ADR-0048). Reads the caller's own-org accounting
 * snapshot rows over `erp_actuals_snapshot` / `erp_ap_aging_snapshot` / `erp_ar_aging_snapshot`.
 * RLS (`org_id = auth_org_id()`) scopes every read — no `org_id` filter is sent by the client. There
 * is NO write path here by design — snapshots are machine-written by the sweep (slice 8), never a
 * client-side writer. The current scope (single as_of) is returned: snapshot-replace publishes exactly
 * one snapshot_id per org, ATOMICALLY (`replace_erp_snapshot`, migration 0150), so every own-org row
 * shares the latest coherent snapshot.
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
 * ⚑ DELETED in audit round 10: `latestSnapshotOnly()` (task FIX-7). It re-filtered the rows in hand to
 * "the first row's snapshot_id", justified by a comment claiming the query ordered `created_at desc`.
 * Since round 9 it ordered the `id` PK ASCENDING, and the scan already pins `snapshot_id = anchor`
 * SERVER-side — so the function was a no-op whose stated basis was false, and under the obvious
 * mutation (drop the server-side `eq`) it would have kept the LOWEST-id row, which has no relationship
 * to recency: it would have silently preserved the STALE generation. Two of its tests passed under
 * exactly that mutation because the fixture's newer row happened to get the lower synthetic id.
 *
 * The server-side `eq` is the real filter; a redundant client-side one that can be wrong is not
 * defence in depth, it is a second place for the truth to live. Its two behavioural tests survive and
 * now prove the SERVER-side filter (they still fail if that `eq` is removed).
 */
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
type SnapshotPage = Promise<{ data: unknown[] | null; error: { message: string; code?: string } | null }>;
interface LooseSnapshotQuery {
  order(column: string, opts?: { ascending?: boolean }): LooseSnapshotQuery;
  eq(column: string, value: string): LooseSnapshotQuery;
  gt(column: string, value: string): LooseSnapshotQuery;
  limit(n: number): LooseSnapshotQuery;
  range(from: number, to: number): SnapshotPage;
  then: SnapshotPage['then'];
}
const loose = supabase as unknown as { from(table: string): { select(columns: string): LooseSnapshotQuery } };

/**
 * ⚑ Audit round 8, the `max_rows` class at this scope. These three reads used to fetch the table
 * UNBOUNDED and then filter to the newest snapshot CLIENT-side. PostgREST caps every response at
 * `max_rows` (1000, `supabase/config.toml`) and signals NOTHING when it does — 200, short body,
 * `error === null`. `erp_actuals_snapshot` is one row per (project x account x fiscal_year), which a
 * mid-size client clears easily (50 projects x 30 accounts x 2 years = 3,000), so the cap could slice
 * through the MIDDLE of the latest snapshot and render a PARTIAL one as complete — understated money,
 * silently, with no way for the reader to tell.
 *
 * Fixed by scoping the read to the ONE snapshot the caller actually wants, server-side, and paging it:
 * resolve the newest `snapshot_id` (a single row), then page every row carrying it. This is strictly
 * less data than before — the old read also dragged back every historical snapshot only to discard it.
 */
async function newestSnapshotId(table: string): Promise<string | null> {
  const newest = await loose.from(table).select('snapshot_id').order('created_at', { ascending: false }).limit(1).range(0, 0);
  if (newest.error) throw new AppError(newest.error.message, newest.error.code);
  return ((newest.data ?? [])[0] as { snapshot_id?: string } | undefined)?.snapshot_id ?? null;
}

/**
 * ⚑ Audit round 9 (HIGH-1) — this function's FIRST version was the round-8 defect wearing the fix's
 * clothes. Two independent faults, both of which returned a PARTIAL money table with `error === null`:
 *
 *  (a) It ordered by `created_at`, which is `default now()` written by ONE `.insert()` of the whole
 *      snapshot (`0101:97`, `actualsSnapshot.ts:227`) — so EVERY row shares the same value. That is
 *      not a TOTAL order, and OFFSET paging over ties lets Postgres return a row twice and skip
 *      another at the page boundary. Ordering on the `id` PK is the only total order here.
 *  (b) The two steps are separate round trips, and the 5-minute sweep replaces the snapshot as a
 *      DELETE + INSERT. Anchor S1, read page 0, sweep swaps S1 -> S2, page 1 for `snapshot_id = S1`
 *      returns ZERO rows — which the pager reads as a legitimate short page and stops. Result: the
 *      first page of a stale generation, rendered as a complete, dated, provenance-stamped table.
 *
 * So: page on the PK, and RE-ASSERT the anchor after the scan. If the newest snapshot moved while we
 * were reading, the rows in hand are a torn mix or a truncated generation — retry ONCE against the new
 * anchor, then fail closed rather than return something that cannot be told apart from the truth.
 *
 * ⚑ AUDIT ROUND 10 — WHAT ATOMICITY CLOSED, AND WHAT IT DID NOT. Migration 0150 makes snapshot-replace
 * ONE statement, so fault (b) no longer produces a torn MIX (two generations can never coexist) and
 * the zero-generation window is gone. It does NOT make this re-assert redundant, because the read is
 * still multi-statement: anchor S1, take page 0, the sweep atomically publishes S2, page 1 for S1
 * returns zero rows — a legitimate-looking SHORT PAGE — and the pager stops, holding a PREFIX of a
 * generation that no longer exists. That is a truncated money table with `error === null`, which is
 * exactly the class this whole file exists to end. Only the re-assert catches it. It is kept, and it
 * is now covered (`erpSnapshots.test.ts`) rather than asserted by comment.
 */
async function latestSnapshotRows(table: string, columns: string): Promise<unknown[]> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const anchor = await newestSnapshotId(table);
    // ⚑ Round-10 MED-1, closed by 0142: no anchor now means ONE thing — no generation has ever been
    // published for this org (or the sweep published an empty one). It used to ALSO mean "we landed in
    // the gap between the replace's delete and its insert", which rendered "No actuals snapshot yet"
    // — byte-identical to never having synced — for the duration of a multi-thousand-row insert, then
    // cached it for 30s. The atomic replace has no such gap, so this empty is honest.
    if (!anchor) return [];
    const rows = await fetchAllRowsByKeyset<{ id: string }>((afterId, limit) => {
      const base = loose.from(table).select(`id,${columns}`).eq('snapshot_id', anchor).order('id', { ascending: true });
      return (afterId === null ? base : base.gt('id', afterId)).limit(limit).range(0, limit - 1) as PromiseLike<{
        data: { id: string }[] | null; error: { message: string; code?: string } | null;
      }>;
    });
    // The anchor still being newest proves no replace landed mid-scan, so these rows are one whole
    // generation. (A replace that lands entirely BEFORE the first read is fine — we anchor on it.)
    if ((await newestSnapshotId(table)) === anchor) return rows;
  }
  throw new AppError('the ERP snapshot was replaced while it was being read — retry', 'snapshot-replaced-mid-read');
}

/** Read the caller's own-org actuals snapshot (current scope). RLS-scoped; empty when no refresh has run. */
export async function listActualsSnapshot(): Promise<ErpActualsSnapshotRow[]> {
  const rows = await latestSnapshotRows('erp_actuals_snapshot', ACTUALS_COLS);
  return (rows as unknown as ActualsDb[]).map(toActualsRow);
}

/** Read the caller's own-org AP aging snapshot (current scope). RLS-scoped; empty when no refresh has run. */
export async function listApAgingSnapshot(): Promise<ErpAgingSnapshotRow[]> {
  const rows = await latestSnapshotRows('erp_ap_aging_snapshot', AGING_COLS);
  return (rows as unknown as AgingDb[]).map(toAgingRow);
}

/** Read the caller's own-org AR aging snapshot (current scope). RLS-scoped; empty when no refresh has run. */
export async function listArAgingSnapshot(): Promise<ErpAgingSnapshotRow[]> {
  const rows = await latestSnapshotRows('erp_ar_aging_snapshot', AGING_COLS);
  return (rows as unknown as AgingDb[]).map(toAgingRow);
}
