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
}

export interface BudgetGateResult {
  versionId: string;
  projectId: string;
  /** OQ-BUD-3(a)'s proposed default: the calendar year containing the project's `start_date` — the ONLY
   *  fiscal year this issue supports pending the owner's ruling on OQ-BUD-3. */
  fiscalYear: string;
  activatedAt: string;
  lineItems: BudgetLineItem[];
}

/** ERPNext's own bench Fiscal Year is literally named by calendar year (spike §5:
 *  `"2026"` ↔ `year_start_date=2026-01-01`/`year_end_date=2026-12-31`). Postgres `date` columns come back
 *  `YYYY-MM-DD` from PostgREST, so a plain string slice resolves the year with zero `Date`/timezone
 *  parsing risk (there is no time component to misparse in the first place). */
function calendarYear(dateIso: string): string {
  return dateIso.slice(0, 4);
}

/**
 * FR-BUD-124 / OQ-BUD-3(a) — ⚑ the PROPOSED DEFAULT, not a policy invented here: OQ-BUD-3 (does one Budget
 * per fiscal year fan out multi-year projects, and how) is still OPEN — owner ruling needed (spec §3,
 * "Blocks sign-off"). Until it is ratified, the spec's own stated default is what this gate enforces: the
 * push targets the fiscal year containing the project's `start_date`, and a project whose `start_date`/
 * `end_date` span MORE THAN ONE calendar year is refused, before any ERP call, rather than PMO inventing a
 * pro-rata/phased split across fiscal years (ADR-0048 — that would be a PMO-authored accounting
 * allocation). A project with no `end_date` (open-ended) is single-FY by construction — nothing to compare
 * the start year against.
 */
function resolveFiscalYearOrFailClosed(project: BudgetGateProjectRow): string {
  if (!project.start_date) {
    throw new BudgetGateError('commit-rejected', 'budget push: the project has no start date to resolve a fiscal year');
  }
  const startYear = calendarYear(project.start_date);
  if (project.end_date) {
    const endYear = calendarYear(project.end_date);
    if (endYear !== startYear) {
      throw new BudgetGateError(
        'budget-multi-fiscal-year',
        `budget push: the project spans fiscal years ${startYear}-${endYear} — no pro-rata split is invented (OQ-BUD-3(a))`,
        undefined,
        startYear,
      );
    }
  }
  return startYear;
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

  const fiscalYear = resolveFiscalYearOrFailClosed(project);

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
