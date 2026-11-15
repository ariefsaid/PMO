import { formatCurrency } from '@/src/lib/format';

export interface BudgetLineLike {
  id?: string;
  category: string;
  description: string | null;
  budgeted_amount: number | string;
  fiscal_year?: string | null;
}

export interface ActualCategoryLike {
  category: string;
  /** Unused here; the summary budgets come from the version's lines. */
  budget?: number;
  actual: number | null;
}

export interface CommitmentLike {
  status: string;
  budget_category: string | null;
  approved_total_value: number | string | null;
  /** The server's open commitment (procurement_open_commitment); absent on rows loaded without it. */
  open_commitment?: number | null;
  total_value: number | string | null;
  currency: string | null;
}

export interface BudgetSummaryRow {
  category: string;
  budget: number;
  spent: number | null;
  committed: number | null;
  lines: BudgetLineLike[];
}

export interface BudgetComparisonRow {
  category: string;
  a: number;
  b: number;
  change: number;
}

export const UNCATEGORIZED = 'Uncategorized';

const COMMITTED_STATUSES = new Set(['Ordered', 'Received', 'Vendor Invoiced', 'Paid']);

export interface CategoryBudgetRollup<T> {
  category: string;
  budget: number;
  lines: T[];
}

/**
 * #1459 — the one budget-category rollup: every Active-version line summed under its category, in
 * first-seen order. The Budget tab's summary rows and the Overview's budget position were two
 * rollups of the same lines, held together only by a parity test.
 *
 * A line with no amount contributes zero (never NaN) and a line with no category is "Other".
 */
export function budgetLinesByCategory<T extends { category: string | null; budgeted_amount: number | string }>(
  lines: readonly T[],
): Array<CategoryBudgetRollup<T>> {
  const byCategory = new Map<string, T[]>();
  for (const line of lines) {
    const category = line.category ?? 'Other';
    const categoryLines = byCategory.get(category) ?? [];
    categoryLines.push(line);
    byCategory.set(category, categoryLines);
  }
  return [...byCategory].map(([category, categoryLines]) => ({
    category,
    budget: categoryLines.reduce((sum, line) => sum + (Number(line.budgeted_amount) || 0), 0),
    lines: categoryLines,
  }));
}

export function buildBudgetSummaryRows(input: {
  lines: BudgetLineLike[];
  actuals: ActualCategoryLike[];
  procurements: CommitmentLike[] | undefined;
  canReadProcurements: boolean;
  currency: string;
  /** Paid spending with no budget category, in the project currency: shown in the Uncategorized row so the rows add
   *  up to what was spent. `null` when it exists but its amount cannot be stated; omitted when there is none. */
  uncategorizedSpent?: number | null;
}): BudgetSummaryRow[] {
  const rollup = budgetLinesByCategory(input.lines);
  const linesByCategory = new Map(rollup.map(({ category, lines }) => [category, lines]));
  const budgetByCategory = new Map(rollup.map(({ category, budget }) => [category, budget]));

  const actualsByCategory = new Map(input.actuals.map((row) => [row.category, row.actual]));
  const committedByCategory = new Map<string, number>();
  const unreadableCategories = new Set<string>();
  const commitmentCategories = new Set<string>();
  if (input.canReadProcurements && input.procurements) {
    for (const procurement of input.procurements) {
      if (!COMMITTED_STATUSES.has(procurement.status)) continue;
      // A commitment with no budget category still spends the budget: count it in its own row,
      // or the committed total and "left" overstate the headroom.
      const category = procurement.budget_category || UNCATEGORIZED;
      commitmentCategories.add(category);
      if (procurement.currency !== input.currency) {
        unreadableCategories.add(category);
        continue;
      }
      // The server's open commitment (FR-PFE-037): when the org reads the ERP ledger it already excludes what the
      // ledger counts as spent, so committed + spent never counts one procurement twice. The list, Overview and
      // this table all use it; total_value is only the fallback for rows loaded without it.
      const rawAmount = procurement.open_commitment ?? procurement.approved_total_value ?? procurement.total_value;
      if (rawAmount === null) {
        unreadableCategories.add(category);
        continue;
      }
      committedByCategory.set(category, (committedByCategory.get(category) ?? 0) + Number(rawAmount));
    }
  }

  const categories = new Set([
    ...linesByCategory.keys(),
    ...actualsByCategory.keys(),
    ...commitmentCategories,
    ...(input.uncategorizedSpent !== undefined ? [UNCATEGORIZED] : []),
  ]);
  return [...categories].map((category) => {
    const categoryLines = linesByCategory.get(category) ?? [];
    return {
      category,
    budget: budgetByCategory.get(category) ?? 0,
    // Without uncategorized paid spending nothing is spent in "Uncategorized" (on the ledger its documents' cost sits in
    // the categories they were posted to), so the row adds commitments only. With it, the row carries that spending, so
    // the rows add up to what was spent; when its amount cannot be stated the row reads unknown, never 0.
    spent: category === UNCATEGORIZED
      ? input.uncategorizedSpent === null ? null : (actualsByCategory.get(category) ?? 0) + (input.uncategorizedSpent ?? 0)
      : actualsByCategory.get(category) ?? null,
    committed: !input.canReadProcurements || !input.procurements || unreadableCategories.has(category)
      ? null
      : committedByCategory.get(category) ?? 0,
    lines: categoryLines,
    };
  });
}

/**
 * Why the categories do not add up to what was spent: paid spending with no budget category. Its amount is stated
 * when known, with its currency and that currency's own precision; otherwise only that it exists.
 */
export function uncategorizedSpendNote(
  amount: number | null,
  currency: string,
  t: (key: string, fallback: string, options?: Record<string, unknown>) => string,
): string {
  return amount === null
    ? t('projectDetail.budget.uncategorizedSpendUnknown', 'Some paid spending has no budget category, so it is not in any category.')
    : t('projectDetail.budget.uncategorizedSpend', '{{amount}} paid has no budget category, so it is not in any category.', { amount: formatCurrency(amount, currency, { precision: 'minor' }) });
}

/**
 * The project's committed spend: the sum of the category rows' commitments, Uncategorized included.
 * The one calculation behind every committed figure on the project (Overview and Budget tab agree, L12);
 * unknown when there are no rows or any row's commitment is unknown — never a partial sum.
 */
export function committedTotal(rows: Pick<BudgetSummaryRow, 'committed'>[]): number | null {
  if (rows.length === 0 || rows.some((row) => row.committed === null)) return null;
  return rows.reduce((sum, row) => sum + (row.committed ?? 0), 0);
}

/** Prefer the shared position; use already-read order rows only when available. */
export function resolveProjectCommitment(openCommitment: string | null, fallbackRows: Pick<BudgetSummaryRow, 'committed'>[] | null): number | null {
  return openCommitment !== null ? Number(openCommitment) : fallbackRows === null ? null : committedTotal(fallbackRows);
}

export function compareBudgetVersions(aLines: BudgetLineLike[], bLines: BudgetLineLike[]): BudgetComparisonRow[] {
  const aByCategory = new Map<string, number>();
  const bByCategory = new Map<string, number>();
  for (const line of aLines) aByCategory.set(line.category, (aByCategory.get(line.category) ?? 0) + Number(line.budgeted_amount));
  for (const line of bLines) bByCategory.set(line.category, (bByCategory.get(line.category) ?? 0) + Number(line.budgeted_amount));
  const categories = new Set([...aByCategory.keys(), ...bByCategory.keys()]);
  return [...categories].map((category) => {
    const a = aByCategory.get(category) ?? 0;
    const b = bByCategory.get(category) ?? 0;
    return { category, a, b, change: b - a };
  });
}
