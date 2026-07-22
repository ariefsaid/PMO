/**
 * erpnext/actualsSnapshot.ts (task 7.3, AC-ENA-060, ADR-0048): refreshActuals — sums MIRRORED
 * `erp_gl_entry_mirror` rows into `erp_actuals_snapshot`. PMO may SUM mirrored ledger rows (ERP
 * truth); it may NEVER invent an accounting figure or read `procurement_invoices` (the FR-ENA-162 /
 * ADR-0048 prohibition). Sums are per (project, cost_center, account, fiscal_year); a refresh mints a
 * new `snapshot_id`, deletes the prior-scope rows, and inserts the summed rows stamping
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
export interface SnapshotSelectBuilder extends PromiseLike<{ data: unknown[] | null; error: { message: string; code?: string } | null }> {
  eq(column: string, value: string | number | boolean | null): SnapshotSelectBuilder;
}
export interface SnapshotDeleteBuilder extends PromiseLike<{ error: { message: string; code?: string } | null }> {
  eq(column: string, value: string | number | boolean | null): SnapshotDeleteBuilder;
}
export interface SnapshotTable {
  select(columns: string): SnapshotSelectBuilder;
  delete(): SnapshotDeleteBuilder;
  insert(rows: unknown[]): Promise<{ error: { message: string; code?: string } | null }>;
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
const GL_MIRROR_ACTUALS_COLUMNS = 'project,cost_center,account,fiscal_year,debit,credit';

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
 *   (1) SELECT mirrored erp_gl_entry_mirror rows (org-scoped; is_cancelled=false) INCLUDING `project`;
 *   (2) resolve each row's PMO project from the binding's inverted `project_map`, then SUM debit/credit
 *       per (project_id, cost_center, account, fiscal_year); net = debit − credit;
 *   (3) new snapshot_id → DELETE the org's prior snapshot rows → INSERT the summed rows.
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
  // (1) Read the mirrored GL read-model (NEVER procurement_invoices).
  const selectBuilder = serviceClient
    .from('erp_gl_entry_mirror')
    .select(GL_MIRROR_ACTUALS_COLUMNS)
    .eq('org_id', orgId)
    .eq('is_cancelled', false);
  const { data: rawRows, error: readErr } = await selectBuilder;
  if (readErr) throw new AppError(readErr.message, readErr.code);
  const rows = (rawRows ?? []) as MirrorRow[];

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
  const newRows = Array.from(buckets.values()).map((b) => ({
    org_id: orgId,
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

  // (3) Snapshot-replace: delete the org's prior snapshot, then insert (single snapshot_id / as_of).
  const deleteBuilder = serviceClient.from('erp_actuals_snapshot').delete().eq('org_id', orgId);
  const { error: delErr } = await deleteBuilder;
  if (delErr) throw new AppError(delErr.message, delErr.code);

  const { error: insErr } = await serviceClient.from('erp_actuals_snapshot').insert(newRows);
  if (insErr) throw new AppError(insErr.message, insErr.code);

  return {
    rows: newRows.length,
    undatedRows: newRows.filter((r) => r.fiscal_year === null || r.fiscal_year === '').length,
  };
}
