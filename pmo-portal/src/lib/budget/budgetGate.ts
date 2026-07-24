/**
 * budget/budgetGate.ts (P3c slice 3 + BFY, FR-BUD-100/101/113/124 + FR-BFY-010/011/021/030/080,
 * ADR-0059 §3.3 + ADR-0055 §6).
 *
 * THE SERVER-SIDE GATE for the budget push. Wired by `adapter-dispatch/index.ts`'s budget path to run
 * BEFORE adapter selection, BEFORE the outbox, BEFORE any ERP call. It re-reads every precondition FROM
 * THE DATABASE — the command payload is NEVER trusted to assert them (ADR-0059 §3.3: "the gate either
 * reads the required state from the DB or it throws — there is no null/absent branch to fall into." The
 * Luna P3a audit found exactly this class of hole).
 *
 * ⚑ BFY (FR-BFY-010/011/030): the gate moves from "resolve ONE fiscal year or refuse" to "produce a
 * PER-YEAR PUSH PLAN". A line item may now carry an optional `fiscal_year` (the ERPNext `Fiscal Year`
 * NAME). The plan fans out to ONE ERP `Budget` per distinct phased fiscal year; a multi-FY project that
 * still has any NULL (un-phased) line FAILS CLOSED naming those lines ("phase these lines") — PMO never
 * invents a pro-rata split (ADR-0048). A single-FY project attributes ALL its lines (NULL or phased to
 * that one year) to that year, byte-for-byte as before (FR-BFY-070). Every phased year is validated
 * against the client's OWN calendar (FR-BFY-021), and a year outside the project's span is refused.
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
 * SPECIFIC reason ('budget-category-unmapped'/'budget-multi-fiscal-year-unphased'/'budget-fiscal-year-
 * invalid'/'budget-fiscal-year-out-of-span') so the side mirror + the operator surface can name the
 * exact cause, never just "rejected".
 */
export class BudgetGateError extends Error {
  readonly code: string;
  readonly unmappedCategories?: string[];
  /** The fiscal year the gate had already resolved at the point of the throw — set on every rejection
   *  that happens AFTER the project/fiscal-year step (the multi-FY/unphased/out-of-span/invalid/map
   *  rejections). `undefined` for an earlier rejection (version/project unreadable, no activation stamp)
   *  where the mirror's `(org_id, budget_version_id, fiscal_year)` grain has no value to key on — the
   *  wiring in `adapter-dispatch/index.ts` skips the durable-failure write in that case rather than
   *  writing a wrong-grain row. BFY: it is the START fiscal year of the project's span (the grain the
   *  failure writers stamp, FR-BFY-010/033). */
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
  /** The Active version's line items (category + budgeted_amount + the BFY `fiscal_year`, decimal-strings). */
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

/** BFY: one entry of the per-year push plan — the phased fiscal year + the line items that belong to it. */
export interface BudgetGatePlanEntry {
  /** The ERPNext `Fiscal Year` NAME this plan entry targets (one ERP `Budget` per entry). */
  fiscal_year: string;
  line_items: BudgetLineItem[];
}

export interface BudgetGateResult {
  versionId: string;
  projectId: string;
  /** The per-year push plan (FR-BFY-030): one entry per phased fiscal year (single-FY ⇒ one entry for
   *  the start year carrying ALL lines). */
  plan: BudgetGatePlanEntry[];
  /** FR-BFY-080: the project's date span, re-read in step 2 EXACTLY as the gate saw it. The dispatch
   *  carries these through a NON-body command field so the mirror writer can stamp the push-time span
   *  witness on every mirror outcome (the projection's stale-year drift detection depends on it). */
  projectStartDate: string | null;
  projectEndDate: string | null;
  /** The ADR-0059 §4 activation stamp (mig 0139) — the deterministic per-year key's epoch source. */
  activatedAt: string;
}

/** The `Fiscal Year` whose [year_start_date, year_end_date] contains `date` (inclusive), or null.
 *  Plain lexicographic compare — every value here is an ISO `YYYY-MM-DD`, for which that IS date order,
 *  and it avoids `Date` parsing (whose timezone handling could push a boundary day into the wrong year —
 *  precisely the class of bug this function exists to prevent). */
function fiscalYearContaining(date: string, fiscalYears: readonly FiscalYearRow[]): FiscalYearRow | null {
  const matches = fiscalYears.filter((fy) => date >= fy.year_start_date && date <= fy.year_end_date);
  // ⚑ AMBIGUITY IS REFUSED, NOT RESOLVED. ERPNext does not prevent OVERLAPPING Fiscal Years, and the
  // doctype list comes back UNORDERED — so a bare `.find()` would return whichever row the API happened
  // to put first. The budget push has TWO originators (the activation consequence and the sweep
  // backstop) reading this list in separate requests: if they picked different years they would derive
  // different keys and mint a SECOND ERP Budget, which is precisely the duplicate the deterministic key
  // exists to prevent. Sorting would make the pick stable but would still be PMO silently choosing which
  // fiscal year a client's budget belongs to — the same "plausible guess" the owner rejected for the
  // multi-FY split (ADR-0048). Overlapping years are a client misconfiguration a human must fix.
  if (matches.length > 1) {
    throw new BudgetGateError(
      'budget-fiscal-year-ambiguous',
      `budget push: ${matches.length} ERPNext Fiscal Years contain ${date} (${matches.map((fy) => fy.name).join(', ')}) — refusing rather than picking one`,
    );
  }
  return matches[0] ?? null;
}

/** The project's fiscal-year span + the set of in-span Fiscal Year names, resolved from the CLIENT'S OWN
 *  calendar (OQ-BUD-3b). Returns `{startFY, endFY, inSpanFYNames}`; `startFY`/`endFY` are the NAMES
 *  containing `start_date`/`end_date` (equal when single-FY or open-ended), and `inSpanFYNames` is every
 *  Fiscal Year whose range overlaps `[start_date, end_date]` — the valid phasing targets (a line phased
 *  outside this set is out-of-span, FR-BFY-021). Fails closed on an unresolvable/ambiguous calendar. */
function resolveSpanOrFailClosed(
  project: BudgetGateProjectRow,
  fiscalYears: readonly FiscalYearRow[],
): { startFY: string; endFY: string; inSpanFYNames: Set<string> } {
  if (!project.start_date) {
    throw new BudgetGateError('commit-rejected', 'budget push: the project has no start date to resolve a fiscal year');
  }
  const startDate = project.start_date;
  const startFy = fiscalYearContaining(startDate, fiscalYears);
  if (!startFy) {
    throw new BudgetGateError(
      'budget-fiscal-year-unresolved',
      `budget push: no ERPNext Fiscal Year contains the project start date ${project.start_date} — refusing rather than guessing a year`,
    );
  }
  let endFyName: string;
  let spanEnd: string;
  if (project.end_date) {
    const endFy = fiscalYearContaining(project.end_date, fiscalYears);
    if (!endFy) {
      throw new BudgetGateError(
        'budget-fiscal-year-unresolved',
        `budget push: no ERPnext Fiscal Year contains the project end date ${project.end_date} — refusing rather than guessing a year`,
        undefined,
        startFy.name,
      );
    }
    endFyName = endFy.name;
    spanEnd = project.end_date;
  } else {
    // An open-ended project is single-FY by construction (FR-BUD-124).
    endFyName = startFy.name;
    spanEnd = startFy.year_end_date;
  }
  // The in-span set = every Fiscal Year whose [start,end] overlaps [project.start_date, spanEnd]. For a
  // 2-year span this is {startFY, endFY}; for a longer span it includes the middle years. A line phased
  // to a real year NOT in this set is out-of-span (FR-BFY-021, OQ-BFY-1). Plain lexicographic compare on
  // ISO dates = date order, as in `fiscalYearContaining`.
  const inSpanFYNames = new Set(
    fiscalYears
      .filter((fy) => fy.year_start_date <= spanEnd && fy.year_end_date >= startDate)
      .map((fy) => fy.name),
  );
  return { startFY: startFy.name, endFY: endFyName, inSpanFYNames };
}

/**
 * BFY: build the per-year push plan (FR-BFY-010/011/030, OQ-BFY-1).
 *
 *  - SINGLE-FY (`startFY === endFY`): one entry for `startFY` carrying ALL the version's lines (NULL or
 *    phased to that year). A line phased to a DIFFERENT valid year ⇒ `budget-fiscal-year-out-of-span`.
 *  - MULTI-FY (`startFY !== endFY`): one entry per DISTINCT phased `fiscal_year`. ANY NULL line ⇒
 *    `budget-multi-fiscal-year-unphased` naming those lines ("phase these lines") — PMO never invents a
 *    pro-rata split (ADR-0048). A line phased outside the project's span ⇒ `budget-fiscal-year-out-of-span`.
 *
 * Plan entries preserve first-seen year order and original line order within each year (deterministic).
 */
function buildPlan(
  project: BudgetGateProjectRow,
  span: { startFY: string; endFY: string; inSpanFYNames: Set<string> },
  lineItems: readonly BudgetLineItem[],
): BudgetGatePlanEntry[] {
  const singleFY = span.startFY === span.endFY;
  if (singleFY) {
    for (const li of lineItems) {
      if (li.fiscal_year && li.fiscal_year !== span.startFY) {
        throw new BudgetGateError(
          'budget-fiscal-year-out-of-span',
          `budget push: line "${li.category}" (${li.budgeted_amount}) is phased to fiscal year "${li.fiscal_year}" which is outside the project's single fiscal year "${span.startFY}" — re-phase it to "${span.startFY}" or remove the phasing`,
          undefined,
          span.startFY,
        );
      }
    }
    return [{ fiscal_year: span.startFY, line_items: [...lineItems] }];
  }
  // Multi-FY: refuse if ANY line is un-phased (PMO has no basis to attribute it — ADR-0048).
  const unphased = lineItems.filter((li) => !li.fiscal_year);
  if (unphased.length > 0) {
    const named = unphased.map((li) => li.category).join(', ');
    throw new BudgetGateError(
      'budget-multi-fiscal-year-unphased',
      `budget push: the project spans fiscal years ${span.startFY}–${span.endFY} but ${unphased.length} line(s) are not phased to a year — phase these lines (no pro-rata split is invented): ${named}`,
      undefined,
      span.startFY,
    );
  }
  // Every phased year must lie within the project's span.
  for (const li of lineItems) {
    if (!span.inSpanFYNames.has(li.fiscal_year as string)) {
      throw new BudgetGateError(
        'budget-fiscal-year-out-of-span',
        `budget push: line "${li.category}" (${li.budgeted_amount}) is phased to fiscal year "${li.fiscal_year}" which is outside the project's span ${span.startFY}–${span.endFY}`,
        undefined,
        span.startFY,
      );
    }
  }
  // Group by fiscal_year, preserving first-seen year order + original line order within each year.
  const byYear = new Map<string, BudgetLineItem[]>();
  for (const li of lineItems) {
    const fy = li.fiscal_year as string;
    let bucket = byYear.get(fy);
    if (!bucket) {
      bucket = [];
      byYear.set(fy, bucket);
    }
    bucket.push(li);
  }
  return [...byYear.entries()].map(([fiscal_year, items]) => ({ fiscal_year, line_items: items }));
}

/**
 * The gate. Order matters (each step fails closed BEFORE the next read runs):
 *  (1) re-read the version's own state — status must be `Active`, and it must carry an activation stamp
 *      (FR-BUD-100/FR-BUD-021 — the deterministic key needs it);
 *  (2) cross-org: the version and its project must both belong to the caller's org (FR-BUD-014), and
 *      re-read the project's CURRENT date span (FR-BFY-080 — the witness source);
 *  (3) resolve the project's fiscal-year SPAN from the client's own `Fiscal Year` doctype — single-FY or
 *      multi-FY (BFY: multi-FY is no longer refused outright; the plan step decides);
 *  (4) read the line items WITH their `fiscal_year`;
 *  (5) validate every phased `fiscal_year` against the client's live calendar (FR-BFY-021) — a value
 *      naming NO Fiscal Year ⇒ `budget-fiscal-year-invalid`;
 *  (6) build the per-year push plan (FR-BFY-010/011/030) — single-FY ⇒ one entry; multi-FY ⇒ one entry
 *      per phased year, refusing any NULL line and any out-of-span year;
 *  (7) the category→account map — unmapped ⇒ FAIL CLOSED (FR-BUD-113), reusing the SAME
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

  const fiscalYears = await deps.readFiscalYears();
  const span = resolveSpanOrFailClosed(project, fiscalYears);

  const lineItems = await deps.readLineItems(deps.versionId);

  // (5) Validate every phased fiscal_year against the client's own calendar — BEFORE the plan/out-of-span
  // step, so a typo naming NO Fiscal Year is reported as 'invalid', not 'out-of-span'.
  const knownFYNames = new Set(fiscalYears.map((fy) => fy.name));
  for (const li of lineItems) {
    if (li.fiscal_year && !knownFYNames.has(li.fiscal_year)) {
      throw new BudgetGateError(
        'budget-fiscal-year-invalid',
        `budget push: line "${li.category}" (${li.budgeted_amount}) is phased to fiscal year "${li.fiscal_year}" which names no ERPnext Fiscal Year — refusing rather than defaulting`,
        undefined,
        span.startFY,
      );
    }
  }

  // (6) Build the per-year push plan.
  const plan = buildPlan(project, span, lineItems);

  // (7) Resolve the category→account map over the plan's union of categories.
  const map = await deps.readCategoryMap();
  try {
    resolveBudgetAccounts(lineItems, map);
  } catch (err) {
    if (err instanceof BudgetCategoryUnmappedError) {
      throw new BudgetGateError('budget-category-unmapped', err.message, err.unmappedCategories, span.startFY);
    }
    throw err;
  }

  return {
    versionId: version.id,
    projectId: project.id,
    activatedAt: version.activated_at,
    plan,
    projectStartDate: project.start_date,
    projectEndDate: project.end_date,
  };
}
