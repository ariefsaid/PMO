/**
 * Pure derivation helper for project budget snapshot. T4 (plan §9 Phase 1).
 * Reads the Active budget version and produces the data needed by the
 * Overview tab "Budget snapshot" card.
 */
import type { BudgetVersionWithItems } from '@/src/lib/db/budgets';

export interface CategoryAmount {
  category: string;
  amount: number;
}

export interface BudgetSnapshot {
  activeTotal: number;
  spent: number;
  /** positive = under-budget; negative = over-budget (destructive color). */
  variance: number;
  byCategory: CategoryAmount[];
}

/**
 * T4: Finds the single Active version among `versions`, computes the snapshot
 * using `spent` (project.spent, from the projects table), and groups line-items
 * by category. Returns null when no Active version exists.
 */
export function activeSnapshot(
  versions: BudgetVersionWithItems[],
  spent: number,
): BudgetSnapshot | null {
  const active = versions.find((v) => v.status === 'Active');
  if (!active) return null;

  const activeTotal = active.total;
  const variance = activeTotal - spent;

  // Group line-items by category, summing budgeted_amount
  const catMap = new Map<string, number>();
  for (const li of active.line_items) {
    const cat = li.category ?? 'Other';
    catMap.set(cat, (catMap.get(cat) ?? 0) + (Number(li.budgeted_amount) || 0));
  }
  const byCategory: CategoryAmount[] = Array.from(catMap.entries())
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

  return { activeTotal, spent, variance, byCategory };
}
