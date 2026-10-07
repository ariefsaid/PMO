/**
 * erpnext/agingSnapshot.ts (task 7.4, FR-ENA-160/161/162, AC-ENA-061, ADR-0048): refreshAging — the
 * AP/AR aging snapshot refresher.
 *
 *   PRIMARY (OQ-3): POST /api/method/frappe.desk.query_report.run (report_name 'Accounts Payable'/
 *     'Accounts Receivable') with the binding's PINNED report_filter_shape (R10 drift mitigation —
 *     this module CONSUMES the pinned shape, no inline get_script). The returned buckets + range
 *     labels are mirrored VERBATIM; report_version/ageing_based_on/report_date provenance is stamped.
 *
 *   FALLBACK (FR-ENA-162 — only when the report shape rejects): bucket MIRRORED
 *     erp_payment_ledger_mirror rows (ERP ledger truth) by due_date age into the same range1..4
 *     boundaries. Invoice-only local math over procurement_invoices (due_date − today on PMO rows)
 *     is PROHIBITED — ADR-0048: that would be PMO-authored accounting truth. procurement_invoices is
 *     never read on either path.
 *
 * Read-source = mirrored read-model + the report RPC ONLY (never a PMO invoice table). Snapshot-replace
 * per scope (new snapshot_id → delete prior scope → insert). Importable by Vitest (app) and the slice-8
 * sweep edge fn (Deno) — relative imports only, structural seams.
 */
import { fetchAllRowsByKeyset } from '../../pagedRead.ts';
import { erpnextRequest, type ErpClientDeps } from './client.ts';
import { publishSnapshot, type SnapshotServiceClient } from './actualsSnapshot.ts';

/** `erp_payment_ledger_mirror`'s uuid PRIMARY KEY (0101 §2) — the KEYSET cursor + stable order. */
const PLE_MIRROR_SCAN_ORDER = 'id';

export type AgingReportName = 'Accounts Payable' | 'Accounts Receivable';
export type AgingSnapshotTable = 'erp_ap_aging_snapshot' | 'erp_ar_aging_snapshot';

export interface AgingRangeLabels {
  range1: string;
  range2: string;
  range3: string;
  range4: string;
}

// range4 is '91-Above': the report's range5 ('121-Above') folds into the b_90_plus bucket at parse
// time (parseAgingReport), so the snapshot's last bucket covers everything 91+ days overdue.
const DEFAULT_RANGE_LABELS: AgingRangeLabels = { range1: '0-30', range2: '31-60', range3: '61-90', range4: '91-Above' };

export interface AgingScope {
  reportName: AgingReportName;
  snapshotTable: AgingSnapshotTable;
  /** The pinned report_filter_shape from binding config (R10). Passed verbatim to the RPC. */
  filters: Record<string, unknown>;
  /** e.g. 'erpnext-15.94.3/frappe-15.96.0' — stamped as report_version provenance. */
  reportVersion: string;
  /** The report's report_date filter (YYYY-MM-DD) — stamped as report_date provenance. */
  reportDate?: string;
  /** 'Due Date' | 'Posting Date' — stamped as ageing_based_on provenance. */
  ageingBasedOn?: string;
  /** Range labels (default 0-30/31-60/61-90/91-Above — range5 folds into the last bucket). */
  rangeLabels?: AgingRangeLabels;
  /** The "today" basis for the fallback due_date age (YYYY-MM-DD); defaults to today UTC. */
  today?: string;
  /** Party-type filter for the fallback (Supplier for AP, Customer for AR). */
  partyType?: string;
}

interface AgingRow {
  party: string | null;
  partyType: string | null;
  currency: string | null;
  total: number;
  current: number;
  range1: number;
  range2: number;
  range3: number;
  range4: number;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
function toNum(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}
function toStr(v: unknown): string | null {
  return v === null || v === undefined || v === '' ? null : String(v);
}

/** POST the pinned report RPC. The client treats POST as no-retry (FR-ENA-042); a report-shape
 *  rejection (4xx) or a transient failure both surface as an ErpError the caller routes to fallback. */
export function runQueryReport(client: ErpClientDeps, reportName: AgingReportName, filters: Record<string, unknown>): Promise<unknown> {
  return erpnextRequest(client, {
    method: 'POST',
    path: '/api/method/frappe.desk.query_report.run',
    body: { report_name: reportName, filters },
  });
}

/** Unwrap the `frappe.desk.query_report.run` `{message: {...}}` envelope (if present). */
function unwrapMessage(body: unknown): Record<string, unknown> {
  if (body !== null && typeof body === 'object' && 'message' in body) {
    const msg = (body as { message: unknown }).message;
    if (msg !== null && typeof msg === 'object' && !Array.isArray(msg)) return msg as Record<string, unknown>;
  }
  return (body ?? {}) as Record<string, unknown>;
}

/** Reads a field from an object row by fieldname OR label (Frappe columns carry both). */
function pick(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) if (row[k] !== undefined) return row[k];
  return undefined;
}

/**
 * Parse the report response into PER-PARTY aging rows. Excludes summary/Total rows (party
 * null/'Total').
 *
 * The v15 detail reports ('Accounts Payable'/'Accounts Receivable') return one row PER VOUCHER
 * with `outstanding` + `range1..range5` — there is NO per-row `total`, NO `current`, and range5
 * ('121-Above') exists beyond the four requested ranges (probed live 2026-07-13; pinned shape in
 * the bench notes). So: aggregate vouchers per party, sum `outstanding` into the party total, and
 * fold range5 into range4 (the snapshot's b_90_plus bucket is "91+ days", label '91-Above') so old
 * debt never vanishes from the buckets. Legacy per-party summary keys (`total`/`current`) are kept
 * as fallbacks for other report versions. Invariant (owned by AC-ENA-061 against the live bench):
 * total reconciles with current + the four buckets.
 */
export function parseAgingReport(body: unknown): AgingRow[] {
  const env = unwrapMessage(body);
  const result = (env.result ?? env.data) as unknown;
  if (!Array.isArray(result)) return [];
  // Keyed by (party, currency): a party with vouchers in two currencies must yield two rows —
  // collapsing them would sum incomparable amounts into one invalid total (Luna review 2026-07-14).
  const byPartyCurrency = new Map<string, AgingRow>();
  for (const raw of result) {
    const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const party = toStr(pick(row, 'party', 'Party', 'supplier', 'customer'));
    if (!party || party === 'Total' || party === 'Grand Total') continue; // exclude summary rows
    const currency = toStr(pick(row, 'currency', 'Currency'));
    const key = `${party}\u0000${currency ?? ''}`;
    const rec = byPartyCurrency.get(key) ?? {
      party,
      partyType: toStr(pick(row, 'party_type', 'Party Type')),
      currency,
      total: 0,
      current: 0,
      range1: 0,
      range2: 0,
      range3: 0,
      range4: 0,
    };
    const outstanding = toNum(pick(row, 'outstanding', 'total', 'Total', 'outstanding_amount'));
    const r1 = toNum(pick(row, 'range1', '0-30'));
    const r2 = toNum(pick(row, 'range2', '31-60'));
    const r3 = toNum(pick(row, 'range3', '61-90'));
    const r45 = toNum(pick(row, 'range4', '91-120')) + toNum(pick(row, 'range5', '121-Above'));
    rec.total += outstanding;
    rec.range1 += r1;
    rec.range2 += r2;
    rec.range3 += r3;
    rec.range4 += r45;
    // Reconciliation invariant (total ≡ current + buckets, AC-ENA-061): whatever part of a voucher's
    // outstanding the report did NOT bucket goes to `current`. Probed live: a FUTURE-due voucher has
    // age<0, outstanding≠0 and range1..5 all 0 — "not yet due" is exactly what `current` means (the
    // v15 detail report has no current column of its own). Negative leftovers (credit notes /
    // unallocated advances) land here too, keeping the invariant for every row shape. An explicit
    // `current` column (legacy summary shape) is part of the bucketed amount, not leftover.
    const explicitCurrent = toNum(pick(row, 'current', 'Current'));
    rec.current += explicitCurrent + (outstanding - (explicitCurrent + r1 + r2 + r3 + r45));
    byPartyCurrency.set(key, rec);
  }
  return [...byPartyCurrency.values()];
}

/** Days between two YYYY-MM-DD dates (today − due). Negative ⇒ not yet due. */
function dayDiff(todayIso: string, dueIso: string): number {
  const t = Date.parse(`${todayIso}T00:00:00Z`);
  const d = Date.parse(`${dueIso}T00:00:00Z`);
  if (Number.isNaN(t) || Number.isNaN(d)) return 0;
  return Math.round((t - d) / 86_400_000);
}

/** Bucket index for an age: 0=current, 1..4=range1..4 (range4 = 91+ days overdue). */
function ageBucket(age: number): 0 | 1 | 2 | 3 | 4 {
  if (age <= 0) return 0; // not yet overdue → current
  if (age <= 30) return 1;
  if (age <= 60) return 2;
  if (age <= 90) return 3;
  return 4;
}

interface PleMirrorRow {
  /** The PK, and the keyset cursor `fetchAllRowsByKeyset` pages on (it is already in the `select`).
   *  Required by the helper's `T extends { id: string }` bound: a keyset scan that cannot read the
   *  cursor off the last row it received cannot ask for the next page, so an unbounded read would
   *  silently stop at PostgREST's `db-max-rows` — the audit-round-8 class this paging exists to end. */
  id: string;
  party: string | null;
  party_type: string | null;
  amount: number | string | null;
  due_date: string | null;
  posting_date: string | null;
}

/** FALLBACK (FR-ENA-162): bucket MIRRORED erp_payment_ledger_mirror rows by due_date age. ERP ledger
 *  truth (PLE carries the per-party open balance + due_date) — NEVER procurement_invoices.
 *
 *  ⚑ Audit round 8 (the HIGH-1 class at this scope): PAGED over the mirror's `id` PK. One unpaged
 *  request is silently capped at PostgREST's `db-max-rows` (1000) — 200, short body, no error — which
 *  understated every party's open balance and stored the shortfall as a dated, provenance-stamped
 *  aging figure indistinguishable from the truth. */
async function bucketFromMirror(svc: SnapshotServiceClient, orgId: string, scope: AgingScope): Promise<AgingRow[]> {
  const data = await fetchAllRowsByKeyset<PleMirrorRow>((afterId, limit) => {
    // #901: a delinked row (cancel / unreconcile) is not owed — ERPNext's own outstanding rule (`delinked = 0`).
    const sel = svc.from('erp_payment_ledger_mirror').select('id,party,party_type,amount,due_date,posting_date')
      .eq('org_id', orgId).eq('delinked', false);
    const filtered = scope.partyType ? sel.eq('party_type', scope.partyType) : sel;
    const ordered = filtered.order(PLE_MIRROR_SCAN_ORDER, { ascending: true });
    return (afterId === null ? ordered : ordered.gt(PLE_MIRROR_SCAN_ORDER, afterId))
      .limit(limit) as PromiseLike<{ data: PleMirrorRow[] | null; error: { message: string; code?: string } | null }>;
  });
  const today = scope.today ?? new Date().toISOString().slice(0, 10);

  const byParty = new Map<string, { party: string; partyType: string | null; total: number; current: number; ranges: [number, number, number, number] }>();
  for (const raw of data) {
    const party = raw.party;
    if (!party) continue;
    const amt = toNum(raw.amount);
    const age = dayDiff(today, raw.due_date ?? raw.posting_date ?? today);
    const b = ageBucket(age);
    let rec = byParty.get(party);
    if (!rec) {
      rec = { party, partyType: raw.party_type, total: 0, current: 0, ranges: [0, 0, 0, 0] };
      byParty.set(party, rec);
    }
    rec.total += amt;
    if (b === 0) rec.current += amt;
    else rec.ranges[b - 1] += amt;
  }
  return Array.from(byParty.values()).map((r) => ({
    party: r.party,
    partyType: r.partyType,
    currency: null, // PLE mirror carries no currency; the primary path supplies it
    total: round2(r.total),
    current: round2(r.current),
    range1: round2(r.ranges[0]),
    range2: round2(r.ranges[1]),
    range3: round2(r.ranges[2]),
    range4: round2(r.ranges[3]),
  }));
}

/**
 * Refresh the AP/AR aging snapshot for ONE org: PRIMARY report-RPC, FALLBACK mirrored-ledger bucketing.
 * Snapshot-replaces per scope ATOMICALLY (new snapshot_id, published by `replace_erp_snapshot` — one
 * statement, so no reader can see two generations or zero). procurement_invoices is never touched on
 * either path (FR-ENA-162 / ADR-0048).
 */
export async function refreshAging(
  serviceClient: SnapshotServiceClient,
  client: ErpClientDeps,
  orgId: string,
  scope: AgingScope,
): Promise<void> {
  let rows: AgingRow[];
  let sourceReport: string;
  try {
    const body = await runQueryReport(client, scope.reportName, scope.filters);
    rows = parseAgingReport(body);
    sourceReport = scope.reportName;
  } catch {
    // PRIMARY failed (report-shape rejection or transient) → the ONLY permitted fallback (FR-ENA-162):
    // bucket MIRRORED ledger rows. A read error here propagates (never silently empty on a real failure).
    rows = await bucketFromMirror(serviceClient, orgId, scope);
    sourceReport = `${scope.reportName} (mirrored-ledger fallback)`;
  }

  const snapshotId = crypto.randomUUID();
  const asOf = new Date().toISOString();
  const rangeLabels = scope.rangeLabels ?? DEFAULT_RANGE_LABELS;
  // No `org_id` on the payload: `replace_erp_snapshot` stamps it from `p_org_id` (0150).
  const newRows = rows.map((r) => ({
    party: r.party,
    party_type: r.partyType,
    currency: r.currency,
    total_outstanding: round2(r.total),
    current: round2(r.current),
    b_0_30: round2(r.range1),
    b_31_60: round2(r.range2),
    b_61_90: round2(r.range3),
    b_90_plus: round2(r.range4),
    range_labels: rangeLabels,
    report_date: scope.reportDate ?? null,
    ageing_based_on: scope.ageingBasedOn ?? null,
    as_of: asOf,
    source_report: sourceReport,
    report_version: scope.reportVersion,
    snapshot_id: snapshotId,
  }));

  await publishSnapshot(serviceClient, scope.snapshotTable, orgId, newRows);
}
