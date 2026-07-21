/**
 * budget/budgetGate.ts (P3c slice 3 — the missing half, FR-BUD-100/101/113/124, ADR-0059 §3.3).
 *
 * THE SERVER-SIDE GATE for the budget push. Wired by `adapter-dispatch/index.ts`'s budget path to run
 * BEFORE adapter selection, BEFORE the outbox, BEFORE any ERP call. It re-reads every precondition FROM
 * THE DATABASE — the command payload is NEVER trusted to assert them (ADR-0059 §3.3: "the gate either
 * reads the required state from the DB or it throws — there is no null/absent branch to fall into." The
 * Luna P3a audit found exactly this class of hole).
 *
 * Pure orchestration over injected readers so it is unit-testable with no live Supabase client;
 * `adapter-dispatch/index.ts` wires `readVersion`/`readProject`/`readLineItems` to the CALLER-scoped
 * (deputy-JWT) client — RLS is the org boundary for those three PMO tables — and `readCategoryMap` to the
 * SAME server-resolved map read `dispatchFactory.ts`'s `readCategoryAccountMap` already uses for the real
 * push, so the gate and the push can never disagree about what "mapped" means.
 */
import { resolveBudgetAccounts, BudgetCategoryUnmappedError, type BudgetLineItem, type CategoryAccountMapRow } from './categoryAccountMap.ts';

/**
 * The classification carried on every gate rejection (FR-BUD-015). A superset of the coarse
 * `AdapterErrorCode` ('commit-rejected'/'external-unreachable'): the gate additionally carries the
 * SPECIFIC reason ('budget-category-unmapped'/'budget-multi-fiscal-year') so the side mirror + the
 * operator surface can name the exact cause, never just "rejected".
 */
export class BudgetGateError extends Error {
  readonly code: string;
  readonly unmappedCategories?: string[];
  /** The fiscal year the gate had already resolved at the point of the throw — set on every rejection
   *  that happens AFTER the project/fiscal-year step (the multi-FY rejection itself, and the map
   *  rejection). `undefined` for an earlier rejection (version/project unreadable, no activation stamp)
   *  where the mirror's `(org_id, budget_version_id, fiscal_year)` grain has no value to key on — the
   *  wiring in `adapter-dispatch/index.ts` skips the durable-failure write in that case rather than
   *  writing a wrong-grain row. */
  readonly fiscalYear?: string;
  constructor(code: string, message: string, unmappedCategories?: string[], fiscalYear?: string) {
    super(message);
    this.name = 'BudgetGateError';
    this.code = code;
    if (unmappedCategories) this.unmappedCategories = unmappedCategories;
    if (fiscalYear) this.fiscalYear = fiscalYear;
  }
}

export interface BudgetVersionGateRow {
  id: string;
  org_id: string;
  project_id: string;
  status: string;
  /** The ADR-0059 §4 state stamp (mig 0139). `null` ⇒ this version has never been activated — the gate
   *  fails closed rather than deriving a degenerate key. */
  activated_at: string | null;
}

export interface BudgetGateProjectRow {
  id: string;
  org_id: string;
  start_date: string | null;
  end_date: string | null;
}

export interface BudgetGateDeps {
  orgId: string;
  versionId: string;
  /** Re-read `budget_versions` for `versionId` — under the CALLER's own JWT (ADR-0059 §3.3). `null` when
   *  the row does not exist OR RLS hides it (a cross-org id) — both are "not readable", never "absent
   *  means allowed". */
  readVersion(versionId: string): Promise<BudgetVersionGateRow | null>;
  /** Re-read `projects` for the version's `project_id` — same caller-scoped posture. */
  readProject(projectId: string): Promise<BudgetGateProjectRow | null>;
  /** The Active version's line items (category + budgeted_amount, decimal-strings). */
  readLineItems(versionId: string): Promise<BudgetLineItem[]>;
  /** The org's `budget_category_account_map` rows (Admin-administered, FR-BUD-110..112). */
  readCategoryMap(): Promise<CategoryAccountMapRow[]>;
  /** ⚑ OQ-BUD-3b (owner ruling 2026-07-21): the CLIENT'S OWN fiscal calendar, read from ERPNext's
   *  `Fiscal Year` doctype. NOT derivable in PMO — a fiscal year is whatever the client says it is
   *  (Apr–Mar, Jul–Jun, …), and Budget's `fiscal_year` is a **Link by NAME** (spike §3: the bench's is
   *  literally named `"2026"` only because that bench is a calendar-year one). Deriving the calendar
   *  year of `start_date` therefore sends an id that, for a non-calendar client, names the WRONG
   *  Fiscal Year or **no Fiscal Year at all** — an invalid Link, not merely an off-by-one label. */
  readFiscalYears(): Promise<FiscalYearRow[]>;
}

/** One ERPNext `Fiscal Year`: its `name` IS the Link value Budget wants (spike §3/§10). */
export interface FiscalYearRow {
  name: string;
  year_start_date: string;
  year_end_date: string;
}

export interface BudgetGateResult {
  versionId: string;
  projectId: string;
  /** The ERPNext `Fiscal Year` NAME containing the project's `start_date` — the exact Link value
   *  Budget's `fiscal_year` field wants. Resolved from the client's own calendar, never derived. */
  fiscalYear: string;
  activatedAt: string;
  lineItems: BudgetLineItem[];
}

/**
 * FR-BUD-124 / OQ-BUD-3 — ⚑ RULED by the owner 2026-07-21: **option (a) now, option (c) as the next
 * issue.** The push targets the fiscal year containing the project's `start_date`; a project spanning
 * MORE THAN ONE fiscal year is refused before any ERP call, rather than PMO inventing a pro-rata/phased
 * split (ADR-0048 — that would be a PMO-authored accounting allocation, and it would make the overspend
 * control wrong in BOTH years). A project with no `end_date` is single-FY by construction.
 *
 * ⚑ OQ-BUD-3b, same ruling: the year comes from the CLIENT'S OWN `Fiscal Year` doctype, never from the
 * calendar year of `start_date`. Both the returned Link value AND the span comparison use real FY
 * ranges, which changes WHICH projects are refused — see `resolveFiscalYearOrFailClosed`.
 */
/** The `Fiscal Year` whose [year_start_date, year_end_date] contains `date` (inclusive), or null.
 *  Plain lexicographic compare — every value here is an ISO `YYYY-MM-DD`, for which that IS date order,
 *  and it avoids `Date` parsing (whose timezone handling could push a boundary day into the wrong year —
 *  precisely the class of bug this function exists to prevent). */
function fiscalYearContaining(date: string, fiscalYears: readonly FiscalYearRow[]): FiscalYearRow | null {
  return fiscalYears.find((fy) => date >= fy.year_start_date && date <= fy.year_end_date) ?? null;
}

function resolveFiscalYearOrFailClosed(project: BudgetGateProjectRow, fiscalYears: readonly FiscalYearRow[]): string {
  if (!project.start_date) {
    throw new BudgetGateError('commit-rejected', 'budget push: the project has no start date to resolve a fiscal year');
  }
  // Fail closed on an unresolvable calendar: an empty/unreadable Fiscal Year list, or a project that
  // starts outside every declared year. NEVER fall back to the calendar year — that is exactly the
  // silent wrong-Link this ruling removed.
  const startFy = fiscalYearContaining(project.start_date, fiscalYears);
  if (!startFy) {
    throw new BudgetGateError(
      'budget-fiscal-year-unresolved',
      `budget push: no ERPNext Fiscal Year contains the project start date ${project.start_date} — refusing rather than guessing a year`,
    );
  }
  if (project.end_date) {
    const endFy = fiscalYearContaining(project.end_date, fiscalYears);
    if (!endFy) {
      throw new BudgetGateError(
        'budget-fiscal-year-unresolved',
        `budget push: no ERPNext Fiscal Year contains the project end date ${project.end_date} — refusing rather than guessing a year`,
        undefined,
        startFy.name,
      );
    }
    // ⚑ The span is judged in the CLIENT'S OWN year ranges, not calendar years. This changes WHICH
    // projects are refused, and that is the point: a 2025-09-01 → 2026-06-30 project spans two
    // CALENDAR years but sits entirely inside ONE Jul–Jun fiscal year, and must push normally.
    if (endFy.name !== startFy.name) {
      throw new BudgetGateError(
        'budget-multi-fiscal-year',
        `budget push: the project spans fiscal years ${startFy.name}–${endFy.name} — no pro-rata split is invented (OQ-BUD-3(a))`,
        undefined,
        startFy.name,
      );
    }
  }
  return startFy.name;
}

/**
 * The gate. Order matters (each step fails closed BEFORE the next read runs):
 *  (1) re-read the version's own state — status must be `Active`, and it must carry an activation stamp
 *      (FR-BUD-100/FR-BUD-021 — the deterministic key needs it);
 *  (2) cross-org: the version and its project must both belong to the caller's org (FR-BUD-014);
 *  (3) single-FY (FR-BUD-124);
 *  (4) the category→account map — unmapped ⇒ FAIL CLOSED (FR-BUD-113), reusing the SAME
 *      `resolveBudgetAccounts` the real push will call, so a gate PASS can never be followed by a push-time
 *      unmapped-category surprise.
 * OD-BUDGET-3 role authorization (FR-BUD-101) and kind↔domain enforcement (FR-BUD-013) are already
 * asserted elsewhere in the served boundary (`authGuard.ts`/`transitionTargetGuard.ts`) — this gate owns
 * only the preconditions those checks cannot see.
 */
export async function runBudgetGate(deps: BudgetGateDeps): Promise<BudgetGateResult> {
  const version = await deps.readVersion(deps.versionId);
  if (!version || version.org_id !== deps.orgId) {
    throw new BudgetGateError('commit-rejected', 'budget push: version not readable');
  }
  if (version.status !== 'Active') {
    throw new BudgetGateError('commit-rejected', 'budget push: version is not Active');
  }
  if (!version.activated_at) {
    throw new BudgetGateError('commit-rejected', 'budget push: version carries no activation stamp');
  }

  const project = await deps.readProject(version.project_id);
  if (!project || project.org_id !== deps.orgId) {
    throw new BudgetGateError('commit-rejected', 'budget push: project not readable');
  }

  const fiscalYear = resolveFiscalYearOrFailClosed(project, await deps.readFiscalYears());

  const lineItems = await deps.readLineItems(deps.versionId);
  const map = await deps.readCategoryMap();
  try {
    resolveBudgetAccounts(lineItems, map);
  } catch (err) {
    if (err instanceof BudgetCategoryUnmappedError) {
      throw new BudgetGateError('budget-category-unmapped', err.message, err.unmappedCategories, fiscalYear);
    }
    throw err;
  }

  return { versionId: version.id, projectId: project.id, fiscalYear, activatedAt: version.activated_at, lineItems };
}
