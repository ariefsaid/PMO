export interface BudgetLineLike {
  id?: string;
  category: string;
  description: string | null;
  budgeted_amount: number | string;
  fiscal_year?: string | null;
}

export interface ActualCategoryLike {
  category: string;
  budget: number;
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

export function buildBudgetSummaryRows(input: {
  lines: BudgetLineLike[];
  actuals: ActualCategoryLike[];
  procurements: CommitmentLike[] | undefined;
  canReadProcurements: boolean;
  currency: string;
}): BudgetSummaryRow[] {
  const linesByCategory = new Map<string, BudgetLineLike[]>();
  for (const line of input.lines) {
    const categoryLines = linesByCategory.get(line.category) ?? [];
    categoryLines.push(line);
    linesByCategory.set(line.category, categoryLines);
  }

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
  ]);
  return [...categories].map((category) => {
    const categoryLines = linesByCategory.get(category) ?? [];
    return {
      category,
    budget: categoryLines.reduce((sum, line) => sum + Number(line.budgeted_amount), 0),
    // Nothing is booked to "Uncategorized" in the accounts: its documents' cost already sits in the
    // categories they were posted to, so this row adds commitments only.
    spent: actualsByCategory.get(category) ?? (category === UNCATEGORIZED ? 0 : null),
    committed: !input.canReadProcurements || !input.procurements || unreadableCategories.has(category)
      ? null
      : committedByCategory.get(category) ?? 0,
    lines: categoryLines,
    };
  });
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
