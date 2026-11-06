import { parseSafeCents, formatNumberCents } from '../exactDecimal';
/**
 * budget/budgetProjection.ts (P3c slice 6, FR-BUD-151) — PMO's FORWARD VIEW.
 *
 * ⚑ "Projection" here = PMO's own forward-looking derived view. It is NOT ADR-0055 §6's "projected into
 * the ERP object" (that means PUSHED — see erpnext/bodies/budget.ts). Nothing computed here is EVER
 * pushed to ERP (FR-BUD-160; structural proof: erpnext/budgetNeverPushesProjection.test.ts, AC-BUD-054).
 *
 * Inputs:
 *   pmoBudgetAmount ← Σ budget_line_items of the ACTIVE version, per category   (PMO SoT, OD-BUDGET-1 —
 *                                                                                 NOT an ERP read-back)
 *   actualsToDate   ← erp_actuals_snapshot.net for the category's MAPPED account (ERP GL truth, P2's
 *                                                                                 shipped snapshot)
 *   pmoEtc          ← budget_projections.pmo_etc                                (PMO-owned, authored)
 *
 * This module is the unit ORACLE; the RPC (mig 0149 get_budget_projection) computes the SAME arithmetic
 * in SQL `numeric` for the real read path. Keep them in step: AC-BUD-050/051 and AC-BUD-053 must agree.
 *
 * Money discipline (NFR-BUD-MONEY-001): decimal-string in, decimal-string out; every sum/difference is
 * done in INTEGER CENTS parsed from the string itself (never `Number(v) * 100`, which reintroduces the
 * binary-float artifact the decimal-string contract exists to avoid) — the same discipline as
 * `categoryAccountMap.ts`'s `toCents`/`fromCents`.
 */

export interface ProjectionInput {
  category: string;
  /** `numeric(14,2)` as a decimal string, or `null` when the Active version budgets no line for this
   *  category (an actual/ETC can still exist with no corresponding budget line — FR-BUD-151). */
  pmoBudgetAmount: string | null;
  /**
   * ⚑ HIGH-1 (audit round 6, 2026-07-22) — is the PMO budget KNOWABLE for the fiscal year being
   * projected at all? `budget_versions` carries no fiscal year of its own (OQ-BUD-3 defers giving it
   * one), so the only in-DB authority is the year the Active version was actually PUSHED for
   * (`budget_version_erp_mirror.fiscal_year`, mirrored by the RPC's `budget_year` CTE).
   *
   * Defaults to `true`: a caller that does not model years is asking about the year the budget is on
   * record for. When `false`, a null `pmoBudgetAmount` means "PMO has no budget for THIS YEAR", which
   * is a different fact from "this category has no line" — the latter honestly yields `-EAC` ("all of
   * this spend is unbudgeted"), the former knows nothing and says so.
   */
  budgetYearOnRecord?: boolean;
  /**
   * ⚑ F-D (BFY, FR-BFY-054/055, review finding 2) — is the budget attribution KNOWN for this
   * CATEGORY in this fiscal year? The SQL twin returns it as `get_budget_projection.attribution_known`
   * (0153 §3a) and this module must branch on it identically.
   *
   * `budgetYearOnRecord` answers a question about the YEAR ("does PMO hold a budget here at all?").
   * This answers a narrower one about the CATEGORY: PMO holds a budget for the year, and this
   * category HAS lines, but they cannot be placed in this year — their only lines are un-phased and
   * the push-time span witness has drifted (the project's dates changed after the push, so "this
   * project is single-FY" is no longer true and no year may be picked or split — ADR-0048).
   *
   * That is a DIFFERENT fact from "this category has no line", and the two must not collapse: the
   * latter honestly yields `-EAC` ("every cent spent here is unbudgeted"), while the former knows
   * nothing about the budget and must say so. Round 1 printed the second when it meant the first.
   *
   * Defaults to `true`: a caller that does not model attribution is asking about a budget it can
   * place, and every existing behaviour is unchanged.
   */
  attributionKnown?: boolean;
  /**
   * `erp_actuals_snapshot.net` summed over the category's MAPPED ERP account.
   *
   * ⚑ C-1 (rendered Discover pass, 2026-07-22) — `null` means the figure is **UNOBTAINABLE**: the
   * category has no `budget_category_account_map` row, so there is no account to ask the ledger about.
   * That is NOT zero, and it must never be folded into one — a genuine zero, "no GL rows this year"
   * and "no ERP account mapped at all" rendered as one byte-identical `$0` on the primary money screen.
   * A mapped category with an empty ledger is `''` (or `'0.00'`) — a real, computed zero.
   */
  actualsToDate: string | null;
  /** `budget_projections.pmo_etc`, or `null` when no ETC row has been authored yet. */
  pmoEtc: string | null;
}

export interface BudgetProjectionCell {
  category: string;
  pmoBudgetAmount: string | null;
  /** C-1: `null` when the category has no mapped ERP account — the figure is unknowable, not zero. */
  actualsToDate: string | null;
  pmoEtc: string;
  /** C-2: `null` whenever `actualsToDate` is — nothing derived from an unknown is knowable either. */
  projectedFinalCost: string | null;
  /** C-2: `null` whenever `actualsToDate` is (never "the entire budget is still available"). */
  projectedVariance: string | null;
  /** `EAC / pmoBudgetAmount`, or `null` on a zero/absent budget, or on an unobtainable actual (C-2) —
   *  never 0, never `Infinity`, never NaN. */
  projectedUtilization: number | null;
}

export interface BudgetComparisonForecastInput {
  category: string;
  /** Approved amount for the comparison scope; null means the amount is unknown. */
  budgetTotal: number | null;
  /** Ledger-recorded spending; null means no reliable figure is available. */
  recorded: number | null;
  /** Existing yearly PMO estimate to complete, defaulted to zero by the repository. */
  pmoEtc: number;
}

export interface BudgetComparisonForecast {
  category: string;
  budgetTotal: number | null;
  recorded: number | null;
  pmoEtc: number;
  projectedFinalCost: number | null;
  projectedRemaining: number | null;
  projectedUtilization: number | null;
}

export interface BudgetComparisonSummaryRow {
  category: string;
  budgetTotal: number | null;
  recorded: number | null;
}

export interface BudgetComparisonSummary {
  budget: number | null;
  recorded: number | null;
  remaining: number | null;
  /** Recorded / approved as a fraction; null on an unknown input or a zero approved total. */
  percentUsed: number | null;
  unknownBudget: string[];
  unknownRecorded: string[];
}

/** Exact decimal-string → integer cents. String-parsed (never `Number(v) * 100`). An absent value
 *  (`null`/`''`) is treated as zero — an absent actuals/ETC row is a legitimate "nothing yet", not an
 *  error (FR-BUD-151); an out-of-grammar string fails closed rather than silently becoming `NaN` → `0`. */
function toCents(value: string | null): number {
  if (value === null || value === '') return 0;
  const cents = parseSafeCents(String(value).trim());
  if (cents === 'invalid') throw new Error(`budgetProjection: invalid decimal amount ${JSON.stringify(value)}`);
  if (cents === 'range') throw new Error(`budgetProjection: amount out of range ${JSON.stringify(value)}`);
  return cents;
}

function fromCents(cents: number): string {
  return formatNumberCents(cents);
}

/**
 * EAC (projected final cost) = actuals-to-date + PMO's estimate-to-complete.
 * Variance = PMO budget − EAC (or `−EAC` when the category has no budget line at all — a silently
 * dropped variance would hide an actual with no corresponding budget line, which is worse than a large
 * negative number).
 * Utilization = EAC / PMO budget, `null` on a zero or absent budget (never a divide-by-zero, never
 * `Infinity`).
 */
export function deriveProjectionCell(input: ProjectionInput): BudgetProjectionCell {
  const etcCents = toCents(input.pmoEtc); // an absent ETC row ⇒ 0, not an error
  // ⚑ F-D (AC-BFY-023) — a suppressed attribution withholds the AMOUNT ITSELF, not only the figures
  // derived from it, and it does so BEFORE the C-2 branch below so the pair (amount stated, attribution
  // unknown) is unreachable on every path. The SQL twin (0153 §3a, BLOCK 2) nulls it for the same
  // reason: with one un-placeable line in the category, the stated sum is a PARTIAL total, and a
  // partial total printed as THE budget understates what PMO holds.
  const attributionUnknown = input.attributionKnown === false;
  const hasBudget = !attributionUnknown && input.pmoBudgetAmount !== null && input.pmoBudgetAmount !== '';
  const budgetCents = hasBudget ? toCents(input.pmoBudgetAmount) : null;

  // ⚑ C-1/C-2 — the honesty branch. With no mapped ERP account there is no account to sum, so the
  // actual is UNKNOWN and every figure downstream of it is unknown too. The PMO-owned halves (budget,
  // ETC) are still stated: they never depended on the ERP map.
  if (input.actualsToDate === null) {
    return {
      category: input.category,
      pmoBudgetAmount: hasBudget ? fromCents(budgetCents as number) : null,
      actualsToDate: null,
      pmoEtc: fromCents(etcCents),
      projectedFinalCost: null,
      projectedVariance: null,
      projectedUtilization: null,
    };
  }

  const actualsCents = toCents(input.actualsToDate);
  const eacCents = actualsCents + etcCents;

  // ⚑ HIGH-1 — the SAME honesty branch, one input to the left. `-EAC` says "every cent spent here is
  // unbudgeted", which is only true when PMO has a budget for this year and it simply has no line for
  // this category. With no budget on record for the year, PMO does not know that, so it states nothing.
  const budgetUnknownForYear = budgetCents === null && input.budgetYearOnRecord === false;

  // ⚑ F-D (AC-BFY-023) — the SAME honesty branch one input further left, and it must OUTRANK the
  // `-EAC` signal below: with the budget attribution suppressed, "every cent spent here is unbudgeted"
  // is a confident accusation derived from something PMO has just admitted it cannot place. It also
  // outranks a stated amount, fail-closed (`hasBudget` above) — an amount and an unknown attribution
  // cannot both be true, so the amount is REFUSED rather than silently preferred.
  const varianceCents = budgetCents === null ? -eacCents : budgetCents - eacCents;
  const projectedUtilization =
    attributionUnknown || budgetCents === null || budgetCents === 0 ? null : eacCents / budgetCents;

  return {
    category: input.category,
    pmoBudgetAmount: hasBudget ? fromCents(budgetCents as number) : null,
    actualsToDate: fromCents(actualsCents),
    pmoEtc: fromCents(etcCents),
    // EAC is untouched by both guards — it is actuals + ETC and never depended on the budget.
    projectedFinalCost: fromCents(eacCents),
    projectedVariance: attributionUnknown || budgetUnknownForYear ? null : fromCents(varianceCents),
    projectedUtilization,
  };
}

/**
 * Add the existing PMO yearly ETC forecast to the canonical approved/recorded comparison.
 * All arithmetic stays in integer cents, and a missing comparison input remains unknown.
 */
export function deriveBudgetComparisonForecast(
  input: BudgetComparisonForecastInput,
): BudgetComparisonForecast {
  const budgetCents = input.budgetTotal === null ? null : toCents(String(input.budgetTotal));
  const recordedCents = input.recorded === null ? null : toCents(String(input.recorded));
  const etcCents = toCents(String(input.pmoEtc));
  const asNumber = (cents: number): number => Number(fromCents(cents));

  const budgetTotal = budgetCents === null ? null : asNumber(budgetCents);
  const recorded = recordedCents === null ? null : asNumber(recordedCents);
  const pmoEtc = asNumber(etcCents);
  if (recordedCents === null) {
    return {
      category: input.category,
      budgetTotal,
      recorded: null,
      pmoEtc,
      projectedFinalCost: null,
      projectedRemaining: null,
      projectedUtilization: null,
    };
  }

  const projectedFinalCostCents = recordedCents + etcCents;
  return {
    category: input.category,
    budgetTotal,
    recorded,
    pmoEtc,
    projectedFinalCost: asNumber(projectedFinalCostCents),
    projectedRemaining: budgetCents === null ? null : asNumber(budgetCents - projectedFinalCostCents),
    projectedUtilization:
      budgetCents === null || budgetCents === 0 ? null : projectedFinalCostCents / budgetCents,
  };
}

/** Summarize all-years comparison rows without turning a partial set into a project total. */
export function summarizeBudgetComparison(
  rows: readonly BudgetComparisonSummaryRow[],
): BudgetComparisonSummary {
  const unknownBudget = rows.filter((row) => row.budgetTotal === null).map((row) => row.category);
  const unknownRecorded = rows.filter((row) => row.recorded === null).map((row) => row.category);
  const sum = (field: 'budgetTotal' | 'recorded'): number | null => {
    if (rows.length === 0 || rows.some((row) => row[field] === null)) return null;
    const cents = rows.reduce((total, row) => total + toCents(String(row[field])), 0);
    if (!Number.isSafeInteger(cents)) throw new Error('budgetProjection: comparison total exceeds safe cents range');
    return cents;
  };

  const budgetCents = sum('budgetTotal');
  const recordedCents = sum('recorded');
  const remainingCents = budgetCents === null || recordedCents === null ? null : budgetCents - recordedCents;
  const asNumber = (cents: number | null): number | null => cents === null ? null : Number(fromCents(cents));
  return {
    budget: asNumber(budgetCents),
    recorded: asNumber(recordedCents),
    remaining: asNumber(remainingCents),
    percentUsed: budgetCents === null || recordedCents === null || budgetCents === 0 ? null : recordedCents / budgetCents,
    unknownBudget,
    unknownRecorded,
  };
}

/** One category as the Forecast panel holds it (numbers off the repository seam). */
export interface SummaryRow {
  category: string;
  pmoBudgetAmount: number | null;
  /** `true` when a null budget is a KNOWN absence ("the Active version has no line here") = budgeted 0. */
  budgetKnownAbsent: boolean;
  actualsToDate: number | null;
  pmoEtc: number;
}

export interface ProjectionSummary {
  /** Each figure is `null` (never 0) while any category it depends on is unknown. */
  budget: number | null;
  recorded: number | null;
  costToFinish: number;
  finalCost: number | null;
  /** Budget − forecast final cost; negative = forecast overrun. */
  remaining: number | null;
  /** Categories whose budget / recorded spending is unknown — the visible reason for a `null` above. */
  unknownBudget: string[];
  unknownRecorded: string[];
}

export interface BudgetProjectionYearOption {
  fiscalYear: string;
  /** The Active version has an approved amount recorded for this client-defined year. */
  hasActiveBudget: boolean;
}

export type BudgetProjectionScope = { kind: 'all' } | { kind: 'year'; year: string };

export interface BudgetProjectionScopeSelection {
  projectId: string;
  scope: BudgetProjectionScope;
}

/**
 * Merge exact client-defined year names from the current project calendar, the saved approved
 * distribution, and other years already offered for this project. Never infer or sort a year from
 * its label. Approved rows remain selectable even after project dates change.
 */
export function mergeBudgetProjectionYears(
  calendarYears: readonly string[] | null,
  approvedDistributionYears: readonly string[],
  observedYears: readonly BudgetProjectionYearOption[],
  approvedBudgetYears: readonly string[] = [],
): BudgetProjectionYearOption[] {
  const ordered: BudgetProjectionYearOption[] = [];
  const indexByYear = new Map<string, number>();
  const add = (fiscalYear: string, hasActiveBudget: boolean) => {
    if (!fiscalYear) return;
    const existingIndex = indexByYear.get(fiscalYear);
    if (existingIndex !== undefined) {
      if (hasActiveBudget) ordered[existingIndex] = { fiscalYear, hasActiveBudget: true };
      return;
    }
    indexByYear.set(fiscalYear, ordered.length);
    ordered.push({ fiscalYear, hasActiveBudget });
  };

  for (const fiscalYear of calendarYears ?? []) add(fiscalYear, false);
  for (const fiscalYear of approvedDistributionYears) add(fiscalYear, true);
  for (const year of observedYears) add(year.fiscalYear, year.hasActiveBudget);
  for (const fiscalYear of approvedBudgetYears) add(fiscalYear, true);
  return ordered;
}

/** Multi-year work opens at the whole-project comparison; a single-year project keeps its year view. */
export function chooseDefaultBudgetProjectionScope(
  years: readonly BudgetProjectionYearOption[],
  yearsWithSpending: ReadonlySet<string>,
): BudgetProjectionScope {
  if (years.length > 1) return { kind: 'all' };
  const fiscalYear = chooseDefaultBudgetFiscalYear(years, yearsWithSpending);
  return fiscalYear ? { kind: 'year', year: fiscalYear } : { kind: 'all' };
}

/** Preserve explicit scope through a refetch; a project change or a vanished year uses the new default. */
export function resolveBudgetProjectionScope(
  projectId: string,
  selection: BudgetProjectionScopeSelection | null,
  years: readonly BudgetProjectionYearOption[],
  yearsWithSpending: ReadonlySet<string>,
): BudgetProjectionScope {
  const fallback = chooseDefaultBudgetProjectionScope(years, yearsWithSpending);
  if (!selection || selection.projectId !== projectId) return fallback;
  if (selection.scope.kind === 'all') return selection.scope;
  const selectedYear = selection.scope.year;
  return years.some((year) => year.fiscalYear === selectedYear) ? selection.scope : fallback;
}

/**
 * Choose the initial year for the budget projection. The repository returns fiscal years in
 * client-defined newest-first order; labels are opaque and are never parsed to infer dates.
 */
export function chooseDefaultBudgetFiscalYear(
  years: readonly { fiscalYear: string; hasActiveBudget: boolean }[],
  yearsWithSpending: ReadonlySet<string>,
): string | null {
  return years.find((year) => yearsWithSpending.has(year.fiscalYear))?.fiscalYear
    ?? years.find((year) => year.hasActiveBudget)?.fiscalYear
    ?? years[0]?.fiscalYear
    ?? null;
}

const toC = (n: number) => Math.round(n * 100); // numeric(14,2) in, so exact at 2 dp
const fromC = (c: number) => c / 100;

/** Project-level totals across categories. One basis: the same rows the grid shows (no second formula). */
export function summarizeProjection(rows: readonly SummaryRow[]): ProjectionSummary {
  const unknownBudget = rows.filter((r) => r.pmoBudgetAmount === null && !r.budgetKnownAbsent).map((r) => r.category);
  const unknownRecorded = rows.filter((r) => r.actualsToDate === null).map((r) => r.category);
  const sum = (f: (r: SummaryRow) => number) => rows.reduce((s, r) => s + toC(f(r)), 0);
  const etcC = sum((r) => r.pmoEtc);
  const budgetC = unknownBudget.length ? null : sum((r) => r.pmoBudgetAmount ?? 0);
  const recordedC = unknownRecorded.length ? null : sum((r) => r.actualsToDate ?? 0);
  const finalC = recordedC === null ? null : recordedC + etcC;
  return {
    budget: budgetC === null ? null : fromC(budgetC),
    recorded: recordedC === null ? null : fromC(recordedC),
    costToFinish: fromC(etcC),
    finalCost: finalC === null ? null : fromC(finalC),
    remaining: budgetC === null || finalC === null ? null : fromC(budgetC - finalC),
    unknownBudget,
    unknownRecorded,
  };
}
