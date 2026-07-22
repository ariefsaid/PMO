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

/** Exact decimal-string → integer cents. String-parsed (never `Number(v) * 100`). An absent value
 *  (`null`/`''`) is treated as zero — an absent actuals/ETC row is a legitimate "nothing yet", not an
 *  error (FR-BUD-151); an out-of-grammar string fails closed rather than silently becoming `NaN` → `0`. */
function toCents(value: string | null): number {
  if (value === null || value === '') return 0;
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value).trim());
  if (!match) {
    throw new Error(`budgetProjection: invalid decimal amount ${JSON.stringify(value)}`);
  }
  const [, sign, whole, fraction = ''] = match;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) {
    throw new Error(`budgetProjection: amount out of range ${JSON.stringify(value)}`);
  }
  return sign === '-' ? -cents : cents;
}

function fromCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
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
  const hasBudget = input.pmoBudgetAmount !== null && input.pmoBudgetAmount !== '';
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
  const varianceCents = budgetCents === null ? -eacCents : budgetCents - eacCents;
  const projectedUtilization = budgetCents === null || budgetCents === 0 ? null : eacCents / budgetCents;

  return {
    category: input.category,
    pmoBudgetAmount: hasBudget ? fromCents(budgetCents as number) : null,
    actualsToDate: fromCents(actualsCents),
    pmoEtc: fromCents(etcCents),
    projectedFinalCost: fromCents(eacCents),
    projectedVariance: budgetUnknownForYear ? null : fromCents(varianceCents),
    projectedUtilization,
  };
}
