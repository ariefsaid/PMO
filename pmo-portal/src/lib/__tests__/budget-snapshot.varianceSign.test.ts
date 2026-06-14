/**
 * AC-W2-9-02: Budget-snapshot variance uses the canonical `spent - budget`
 * convention (positive = over-budget), matching dashboard.ts:131 / BudgetReviewRow
 * / FinanceDashboard.
 *
 * Previous convention: `variance = activeTotal - spent` (positive = under-budget).
 * Fixed convention:    `variance = spent - activeTotal` (positive = over-budget).
 *
 * The OverviewTab "Variance" row renders destructive color when variance > 0 (over),
 * and a "+" prefix when > 0 (same logic as BudgetReviewRow in FinanceDashboard).
 */
import { describe, it, expect } from 'vitest';
import { activeSnapshot } from '../budget-snapshot';
import type { BudgetVersionWithItems } from '@/src/lib/db/budgets';

function makeVersion(lineItems: Array<{ category: string; budgeted_amount: number }>): BudgetVersionWithItems {
  const line_items = lineItems.map((li, i) => ({
    id: `li-${i}`,
    budget_version_id: 'v1',
    org_id: 'org-1',
    category: li.category,
    description: null,
    budgeted_amount: li.budgeted_amount,
    actual_amount: 0,
  }));
  const total = line_items.reduce((s, li) => s + li.budgeted_amount, 0);
  return {
    id: 'v1',
    project_id: 'p1',
    org_id: 'org-1',
    version: 1,
    name: 'Active v1',
    status: 'Active',
    created_at: '2026-01-01',
    total,
    line_items,
  } as unknown as BudgetVersionWithItems;
}

const activeVersion = makeVersion([
  { category: 'Labour', budgeted_amount: 100_000 },
]);
// activeTotal = 100,000

describe('AC-W2-9-02: activeSnapshot variance sign — canonical (spent - budget)', () => {
  it('over-budget (spent > budget): variance is POSITIVE (over = +20)', () => {
    // spent 120k, budget 100k → variance = 120k - 100k = +20k (over).
    const snap = activeSnapshot([activeVersion], 120_000)!;
    expect(snap).not.toBeNull();
    expect(snap.variance).toBe(20_000);   // positive = over-budget
  });

  it('under-budget (spent < budget): variance is NEGATIVE (under = -20)', () => {
    // spent 80k, budget 100k → variance = 80k - 100k = -20k (under).
    const snap = activeSnapshot([activeVersion], 80_000)!;
    expect(snap.variance).toBe(-20_000);  // negative = under-budget
  });

  it('exactly on-budget: variance is 0', () => {
    const snap = activeSnapshot([activeVersion], 100_000)!;
    expect(snap.variance).toBe(0);
  });
});
