// T4 — budget snapshot pure derivation helper
import { describe, it, expect } from 'vitest';
import { activeSnapshot } from './budget-snapshot';
import type { BudgetVersionWithItems } from '@/src/lib/db/budgets';

const makeVersion = (
  id: string,
  status: string,
  lineItems: Array<{ category: string; budgeted_amount: number; actual_amount: number }>,
): BudgetVersionWithItems => {
  const line_items = lineItems.map((li, i) => ({
    id: `li-${id}-${i}`,
    budget_version_id: id,
    org_id: 'o1',
    category: li.category,
    description: null,
    budgeted_amount: li.budgeted_amount,
    actual_amount: li.actual_amount,
  }));
  const total = line_items.reduce((s, li) => s + Number(li.budgeted_amount), 0);
  return {
    id,
    project_id: 'p1',
    org_id: 'o1',
    version: 1,
    name: `v${id}`,
    status,
    created_at: '2026-01-01',
    total,
    line_items,
  } as unknown as BudgetVersionWithItems;
};

const activeVersion = makeVersion('v1', 'Active', [
  { category: 'Labour', budgeted_amount: 100_000, actual_amount: 80_000 },
  { category: 'Materials', budgeted_amount: 50_000, actual_amount: 10_000 },
  { category: 'Labour', budgeted_amount: 20_000, actual_amount: 5_000 },
]);

const draftVersion = makeVersion('v2', 'Draft', [
  { category: 'Labour', budgeted_amount: 200_000, actual_amount: 0 },
]);

describe('T4 — activeSnapshot', () => {
  it('finds the Active version and computes totals (T4)', () => {
    const snap = activeSnapshot([draftVersion, activeVersion], 90_000);
    expect(snap).not.toBeNull();
    expect(snap!.activeTotal).toBe(170_000); // 100k+50k+20k
  });

  it('uses the passed spent value not line-item actual_amount (T4)', () => {
    const snap = activeSnapshot([activeVersion], 95_000);
    expect(snap!.spent).toBe(95_000);
  });

  it('computes under-budget variance correctly (T4 — AC-W2-9-02: spent - budget, negative = under)', () => {
    // spent 90k, activeTotal 170k → variance = 90k - 170k = -80k (under-budget)
    const snap = activeSnapshot([activeVersion], 90_000)!;
    expect(snap.variance).toBe(-80_000); // spent - budget: negative = under-budget (healthy)
  });

  it('computes over-budget variance (overspend) correctly (T4 — AC-W2-9-02)', () => {
    // spent 200k, activeTotal 170k → variance = 200k - 170k = +30k (over-budget)
    const snap = activeSnapshot([activeVersion], 200_000)!;
    expect(snap.variance).toBe(30_000); // positive = over-budget (destructive)
  });

  it('groups line items by category and sums budgeted amounts (T4)', () => {
    const snap = activeSnapshot([activeVersion], 0)!;
    const labour = snap.byCategory.find((c) => c.category === 'Labour');
    const materials = snap.byCategory.find((c) => c.category === 'Materials');
    expect(labour?.amount).toBe(120_000); // 100k + 20k
    expect(materials?.amount).toBe(50_000);
  });

  it('returns null when no Active version exists (T4 null-safe)', () => {
    const snap = activeSnapshot([draftVersion], 0);
    expect(snap).toBeNull();
  });

  it('returns null for empty versions array (T4 edge)', () => {
    expect(activeSnapshot([], 0)).toBeNull();
  });
});
