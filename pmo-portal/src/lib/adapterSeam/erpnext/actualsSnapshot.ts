/**
 * erpnext/actualsSnapshot.ts (task 7.3, AC-ENA-060, ADR-0048): refreshActuals — sums MIRRORED
 * `erp_gl_entry_mirror` rows into `erp_actuals_snapshot`. PMO may SUM mirrored ledger rows (ERP
 * truth); it may NEVER invent an accounting figure or read `procurement_invoices` (the FR-ENA-162 /
 * ADR-0048 prohibition). Sums are per (project, cost_center, account, fiscal_year); a refresh mints a
 * new `snapshot_id` and publishes it through the ATOMIC `replace_erp_snapshot` RPC (0142) — the prior
 * generation is removed and the summed rows inserted in ONE statement — stamping
 * `source_report='GL Entry'` + `as_of`.
 *
 * Read-source = the mirrored read-model ONLY (never a live ERP fetch) — the slice-8 sweep feed
 * (8.x) keeps `erp_gl_entry_mirror` fresh; this module is the slice-7 consumer. Importable by Vitest
 * (app) and by the slice-8 sweep edge fn (Deno) — relative imports only, structural service-client
 * seam (no supabase-js nominal dep).
 */
import { AppError } from '../../appError.ts';
import { fetchAllRowsByKeyset } from '../../pagedRead.ts';

/** Structural service-role client seam (matches supabase-js): `.from(t).select(c).eq().eq().order().range()`
 *  (thenable) for the mirror READS, and `.rpc(fn, args)` for the one WRITE — the atomic snapshot
 *  replace. Real supabase-js is not nominally assignable (thenable PostgrestFilterBuilder) — callers
 *  cast `as never` at the boundary.
 *
 *  ⚑ HIGH-1 (audit round 10): `delete()`/`insert()` are deliberately GONE from this seam. They were
 *  the affordance that made snapshot-replace two round trips, which is what let two generations of the
 *  same money coexist (and a reader land on zero of them). The only way to publish a generation is now
 *  `replace_erp_snapshot`, which does both in ONE statement (migration 0142). */
export interface SnapshotServiceClient {
  from(table: string): SnapshotTable;
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}
export interface SnapshotSelectBuilder extends PromiseLike<{ data: unknown[] | null; error: { message: string; code?: string } | null }> {
  eq(column: string, value: string | number | boolean | null): SnapshotSelectBuilder;
  /** The TOTAL, STABLE order a paged scan needs — without it consecutive pages can overlap or gap. */
  order(column: string, opts?: { ascending?: boolean }): SnapshotSelectBuilder;
  /** The KEYSET cursor: resume strictly AFTER the last row of the previous page. */
  gt(column: string, value: string): SnapshotSelectBuilder;
  /** One page's size. Without a bound PostgREST silently caps the response at `db-max-rows`. */
  limit(n: number): SnapshotSelectBuilder;
}
export interface SnapshotTable {
  select(columns: string): SnapshotSelectBuilder;
}

/** The one write: `public.replace_erp_snapshot(p_table, p_org_id, p_rows)` (migration 0142). */
const REPLACE_SNAPSHOT_RPC = 'replace_erp_snapshot';

/**
 * Publish ONE snapshot generation for one org, atomically.
 *
 * ⚑ HIGH-1 (Luna audit round 10, 2026-07-22). This used to be `await delete().eq('org_id', orgId)`
 * followed by `await insert(rows)` — two PostgREST round trips, despite 0101's table comment claiming
 * they ran "in the SAME service-role tx". The sweep cron fires `net.http_post` fire-and-forget every
 * five minutes with no single-flight guard (0102), so passes overlap by construction, and the
 * interleave (A deletes, A inserts, B's delete finds nothing to remove because A's insert has not
 * committed, B inserts) leaves TWO generations of the same money in the table. `get_budget_projection`
 * summed across them with no `snapshot_id` predicate at all, so a $40,000 category reported $80,000:
 * an EAC of $115,000 against a $100,000 budget, a −$15,000 overrun that does not exist, 1.15
 * utilization — stamped fresh by `max(as_of)` and persistent until the next successful sweep. Between
 * the delete and the insert the org's snapshot was also genuinely EMPTY, which the dashboard renders
 * as "No actuals snapshot yet", byte-identical to an org that has never synced.
 *
 * One statement, one transaction, no window. `org_id` is stamped by the definer from `p_org_id`, so
 * the payload never decides which tenant a money row lands in.
 */
export async function publishSnapshot(
  serviceClient: SnapshotServiceClient,
  table: string,
  orgId: string,
  rows: unknown[],
): Promise<void> {
  const { error } = await serviceClient.rpc(REPLACE_SNAPSHOT_RPC, { p_table: table, p_org_id: orgId, p_rows: rows });
  if (error) throw new AppError(error.message, error.code);
}

export interface ActualsScope {
  /**
   * ⚑ NEW-1 (audit round 4) — the ERP-project ↔ PMO-project mapping, verbatim from the org's
   * `external_org_bindings.config.project_map`: **PMO project id → ERPNext `Project` NAME**. It is the
   * SAME (and only) seam `dispatchFactory.ts` uses to resolve `ctx.refs.project` for the budget push
   * and every timesheet entry — this module consumes it INVERTED and never invents a second mapping.
   *
   * Absent/empty ⇒ nothing is attributable, and every row lands in the unattributed bucket rather than
   * being attributed by guess.
   *
   * There is deliberately NO `projectId` here any more. It was a caller-supplied STAMP that production
   * always left empty, so every snapshot row carried `project_id = NULL` while
   * `get_budget_projection` joined `s.project_id = p_project_id`; the primary money screen therefore
   * reported "Actuals to date 0.00" for every project with real posted GL spend. Attribution now comes
   * from the dimension ERP itself states on the GL row, so there is no scope left to lie.
   */
  projectMap?: Readonly<Record<string, unknown>>;
}

interface MirrorRow {
  /** The mirror's uuid PK — read only to give the paged scan a total, stable order. */
  id: string;
  /** The ERPNext `Project` NAME the GL row itself states (`erp_gl_entry_mirror.project`, 0101). */
  project: string | null;
  cost_center: string | null;
  account: string | null;
  fiscal_year: string | null;
  debit: number | string | null;
  credit: number | string | null;
}

interface SumBucket {
  /** The resolved PMO project uuid, or `null` for the explicit UNATTRIBUTED bucket. */
  projectId: string | null;
  costCenter: string | null;
  account: string | null;
  fiscalYear: string | null;
  debit: number;
  credit: number;
}

/**
 * The GL-mirror columns this refresh reads. `project` is load-bearing: it is the dimension ERP itself
 * states on the row, and it is the ONLY thing that makes a snapshot row attributable to a PMO project
 * — a column that is never SELECTed can never be attributed by.
 */
const GL_MIRROR_ACTUALS_COLUMNS = 'id,project,cost_center,account,fiscal_year,debit,credit';

/**
 * The mirror's uuid PRIMARY KEY (0101 §1) — the KEYSET cursor + total, stable order for the paged scan
 * below. Postgres guarantees no row order across statements, so paging without this tiebreaker could
 * return one GL row twice and miss another: double-counted money, worse than the truncation it fixes.
 * Keyset (not offset) because the 5-minute sweep cron has no single-flight guard, so a slow ledger
 * backfill tick overlaps the next tick's scan — exactly in the >1000-row regime that matters.
 */
const GL_MIRROR_SCAN_ORDER = 'id';

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

function toNumber(v: number | string | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** NUL: cannot occur in an ERPNext name/account/cost-centre, so no two distinct groups collide. */
const SEP = String.fromCharCode(0);

function groupKey(projectId: string | null, costCenter: string | null, account: string | null, fiscalYear: string | null): string {
  return [projectId ?? '', costCenter ?? '', account ?? '', fiscalYear ?? ''].join(SEP);
}

/**
 * INVERT the binding's `project_map` (PMO project id → ERP project NAME) into the lookup this module
 * needs (ERP project NAME → PMO project id). An ERP name claimed by TWO PMO projects has no single
 * truthful answer, so it resolves to `null` (unattributed) rather than to whichever entry happened to
 * be enumerated last — mis-attributed money is worse than visibly unattributed money.
 */
function invertProjectMap(
  projectMap: Readonly<Record<string, unknown>> | undefined,
): ReadonlyMap<string, string | null> {
  const inverse = new Map<string, string | null>();
  for (const [pmoProjectId, erpName] of Object.entries(projectMap ?? {})) {
    if (typeof erpName !== 'string' || erpName === '') continue;
    inverse.set(erpName, inverse.has(erpName) ? null : pmoProjectId);
  }
  return inverse;
}

/**
 * What ONE refresh actually wrote — specifically, whether any of it landed somewhere NO screen can
 * select, so the caller can surface that instead of reporting a silent success over invisible money.
 *
 * `undatedRows` is the honest-gap counter. `erp_actuals_snapshot.fiscal_year` is nullable (0101), and
 * BOTH readers match it by equality — `get_budget_projection` selects `s.fiscal_year = p_fiscal_year`
 * (and `= NULL` is never true) while `list_budget_fiscal_years` deliberately never OFFERS a null year.
 * So a GL row whose fiscal year ERPNext never stated is stored but invisible under EVERY year. PMO
 * does not own the client's fiscal calendar and must never invent a year for it (the same ruling that
 * governs the `NaN` watermarks and the missing `company`) — so the row keeps its honest NULL, and the
 * gap is COUNTED here and raised to an operator by the sweep. A visible gap beats a plausible guess.
 *
 * The unattributed-project bucket (`project_id = null`) is deliberately NOT counted here: a GL entry
 * with no project dimension is the ordinary case in any real ledger (cash, creditors, overhead), so
 * raising it would be noise, not signal. It is still summed, still stored, and still queryable.
 */
export interface ActualsRefreshSummary {
  /** Snapshot rows written (groups), including the unattributed/undated ones. */
  rows: number;
  /** Rows carrying NO fiscal year — stored, but selectable under no fiscal year the UI can offer. */
  undatedRows: number;
}

/**
 * Refresh the actuals snapshot for ONE org by summing its mirrored GL rows. Steps:
 *   (1) SELECT mirrored erp_gl_entry_mirror rows (org-scoped; is_cancelled=false) INCLUDING `project`,
 *       PAGED over `id` — one unpaged request is silently capped at PostgREST's `max_rows` (HIGH-1);
 *   (2) resolve each row's PMO project from the binding's inverted `project_map`, then SUM debit/credit
 *       per (project_id, cost_center, account, fiscal_year); net = debit − credit;
 *   (3) new snapshot_id → publish it through the ATOMIC `replace_erp_snapshot` RPC (one statement:
 *       the org's prior generation is removed and the new one inserted, with no observable window).
 *
 * The refresh is ORG-WIDE by construction: every project's rows are re-derived from the mirror on every
 * pass, so the delete is the whole org's scope and no project can be left holding a stale snapshot.
 *
 * ADR-0048: this is ERP truth (sums of mirrored rows), never a PMO-authored figure; procurement_invoices
 * is never touched on any path.
 */
export async function refreshActuals(
  serviceClient: SnapshotServiceClient,
  orgId: string,
  scope: ActualsScope,
): Promise<ActualsRefreshSummary> {
  // (1) Read the mirrored GL read-model (NEVER procurement_invoices) — PAGED.
  //
  // ⚑ HIGH-1 (audit round 8). This was ONE unpaged request. PostgREST caps every response at
  // `db-max-rows` (1000) and says NOTHING when it truncates — 200, short body, no error — so past
  // 1000 mirrored rows this summed an arbitrary subset, deleted the whole prior snapshot and stored
  // the shortfall with a FRESH `as_of`. The projection then saw a non-null reading on a mapped
  // category and CERTIFIED the wrong number as known. Money is summed over ALL rows or not at all:
  // a page error throws BEFORE the delete below, so a partial read can never replace a good snapshot.
  const rows = await fetchAllRowsByKeyset<MirrorRow>((afterId, limit) => {
    const q = serviceClient
      .from('erp_gl_entry_mirror')
      .select(GL_MIRROR_ACTUALS_COLUMNS)
      .eq('org_id', orgId)
      .eq('is_cancelled', false)
      .order(GL_MIRROR_SCAN_ORDER, { ascending: true });
    return (afterId === null ? q : q.gt(GL_MIRROR_SCAN_ORDER, afterId))
      .limit(limit) as PromiseLike<{ data: MirrorRow[] | null; error: { message: string; code?: string } | null }>;
  });

  // (2) Attribute from the dimension ERP states, then sum per (project, cost_center, account, FY).
  const erpNameToPmoProject = invertProjectMap(scope.projectMap);
  const buckets = new Map<string, SumBucket>();
  for (const row of rows) {
    const projectId = row.project ? (erpNameToPmoProject.get(row.project) ?? null) : null;
    const key = groupKey(projectId, row.cost_center, row.account, row.fiscal_year);
    let b = buckets.get(key);
    if (!b) {
      b = { projectId, costCenter: row.cost_center, account: row.account, fiscalYear: row.fiscal_year, debit: 0, credit: 0 };
      buckets.set(key, b);
    }
    b.debit += toNumber(row.debit);
    b.credit += toNumber(row.credit);
  }

  const snapshotId = crypto.randomUUID();
  const asOf = new Date().toISOString();
  // No `org_id` on the payload: `replace_erp_snapshot` stamps it from `p_org_id` and ignores anything
  // the caller puts here, so there is no caller-shaped route to another tenant's ledger.
  const newRows = Array.from(buckets.values()).map((b) => ({
    project_id: b.projectId,
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

  // (3) Snapshot-replace, ATOMICALLY (single snapshot_id / as_of). See publishSnapshot.
  await publishSnapshot(serviceClient, 'erp_actuals_snapshot', orgId, newRows);

  return {
    rows: newRows.length,
    undatedRows: newRows.filter((r) => r.fiscal_year === null || r.fiscal_year === '').length,
  };
}
