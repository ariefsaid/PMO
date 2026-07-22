/**
 * budget/categoryAccountMap.ts (P3c, FR-BUD-110..114) — ⚑ THE CRUX of the budget push.
 *
 * PMO budgets a `budget_category` (7 values, OD-BUDGET-4); an ERP `Budget` line is per ACCOUNT (the
 * client's own Chart of Accounts — there is NO natural correspondence, budget-write spike §4). This module
 * is the boundary. It is PMO-side and carries NO Frappe vocabulary (NFR-BUD-CONTRACT-001): it emits
 * `{account, budget_amount}` pairs and `erpnext/bodies/budget.ts` puts them into a Frappe body.
 *
 * ⚑ FAIL CLOSED (FR-BUD-113). An unmapped, NON-ZERO category THROWS. It never falls back to a default,
 * fallback or suspense account, and never silently drops the line:
 *   - a silently-defaulted line makes ERP enforce its overspend controls against the WRONG account, i.e.
 *     the feature actively misleading the client;
 *   - a silently-dropped line under-budgets ERP, so a purchase that PMO approved gets blocked/warned.
 * It throws rather than returning a partial list for the same reason — a partial push is a wrong push. And
 * it names EVERY unmapped category at once, so the operator fixes the map in one round-trip.
 *
 * Money is decimal-string end-to-end and summed in INTEGER CENTS parsed from the string itself
 * (NFR-BUD-MONEY-001) — no `Number(v) * 100`, which reintroduces the binary-float artifact the
 * decimal-string contract exists to avoid.
 */
import { AdapterError } from '../adapterSeam/contract.ts';

/** OD-BUDGET-4's locked 7-value enum (mig 0001's `budget_category`). Kept as a documented union; the
 *  functions accept a bare string too, because the DB is the enum authority and an unknown value must
 *  reach the fail-closed branch rather than a type error at a runtime boundary. */
export type BudgetCategory =
  | 'Labor'
  | 'Materials'
  | 'Subcontractors'
  | 'Equipment'
  | 'Permits & Fees'
  | 'Overheads'
  | 'Contingency';

export interface BudgetLineItem {
  category: BudgetCategory | string;
  /** `numeric(14,2)` as a decimal string (PostgREST returns numeric as a string). */
  budgeted_amount: string;
}

/** One row of `budget_category_account_map` (mig 0137) — the org's Admin-administered bijection. */
export interface CategoryAccountMapRow {
  category: BudgetCategory | string;
  erp_account: string;
}

/** One ERP `Budget Account` child row (spike §4: exactly these two fields, nothing else). */
export interface BudgetAccountRow {
  account: string;
  budget_amount: string;
}

/** FR-BUD-113 / FR-BUD-015: a NON-RETRYABLE `commit-rejected` bucket — never blind-retried, because no
 *  amount of retrying creates a map row. Only an Admin editing the map clears it. */
export class BudgetCategoryUnmappedError extends Error {
  readonly code = 'budget-category-unmapped';
  constructor(readonly unmappedCategories: string[]) {
    super(`budget categories have no ERP account mapping: ${unmappedCategories.join(', ')}`);
    this.name = 'BudgetCategoryUnmappedError';
  }
}

/** Exact decimal-string → integer cents. String-parsed (never `Number(v)*100`) so `30000.10 + 20000.20`
 *  is exactly `50000.30`, and a value outside the decimal grammar is REFUSED rather than becoming `NaN`
 *  → `0` (a silent under-budget in the client's ERP). */
function toCents(value: string): number {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value).trim());
  if (!match) {
    throw new AdapterError('commit-rejected', `invalid decimal budget amount: ${JSON.stringify(value)}`);
  }
  const [, sign, whole, fraction = ''] = match;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) {
    throw new AdapterError('commit-rejected', `budget amount out of range: ${JSON.stringify(value)}`);
  }
  return sign === '-' ? -cents : cents;
}

function fromCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Resolve an Active version's line items → the ERP `accounts[]` rows.
 *
 * 1. sum integer cents per category (a category may have many line items);
 * 2. drop ZERO totals — ERP has no meaning for a zero budget line, and this is NOT an error
 *    (FR-BUD-114), so an unmapped zero category never blocks a push either;
 * 3. ⚑ collect EVERY unmapped non-zero category and throw naming ALL of them;
 * 4. emit one row per mapped category, in first-seen line-item order (deterministic bodies).
 *
 * An EMPTY result is returned as-is. The caller MUST refuse to push it: the ERP `Budget` doctype crashes
 * with a raw 500 (`ba.account in ()`, spike §10(a)) on an empty `accounts` array — an unclassifiable,
 * never-retryable error. `budgetToBody` owns that guard.
 */
export function resolveBudgetAccounts(
  lineItems: readonly BudgetLineItem[],
  map: readonly CategoryAccountMapRow[],
): BudgetAccountRow[] {
  const centsByCategory = new Map<string, number>();
  for (const item of lineItems) {
    centsByCategory.set(item.category, (centsByCategory.get(item.category) ?? 0) + toCents(item.budgeted_amount));
  }

  const accountFor = new Map(map.map((row) => [row.category, row.erp_account]));
  const nonZero = [...centsByCategory.entries()].filter(([, cents]) => cents !== 0);

  // ⚑ Collect ALL unmapped first — never throw on the first one.
  const unmapped = nonZero.filter(([category]) => !accountFor.has(category)).map(([category]) => category);
  if (unmapped.length > 0) throw new BudgetCategoryUnmappedError(unmapped);

  return nonZero.map(([category, cents]) => ({
    account: accountFor.get(category) as string,
    budget_amount: fromCents(cents),
  }));
}
