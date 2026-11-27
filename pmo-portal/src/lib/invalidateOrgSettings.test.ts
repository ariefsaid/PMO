import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { invalidateAfterOrgCostSetting, UNAFFECTED_BY_COST_SETTINGS } from './invalidateOrgSettings';

async function seeded(roots: string[]) {
  const qc = new QueryClient();
  const reads: Record<string, () => Promise<number>> = {};
  for (const r of roots) {
    reads[r] = vi.fn(async () => 1);
    await qc.fetchQuery({ queryKey: [r, 'org-1'], queryFn: reads[r] });
  }
  return { qc, reads };
}

describe('invalidateAfterOrgCostSetting', () => {
  it('marks stock, procurement, project-money and ledger reads stale and leaves unrelated reads alone', async () => {
    const dependents = ['stock-on-hand', 'procurements', 'projects-money', 'project-finances', 'budget-comparison', 'odoo-ledger', 'financial-statements', 'dashboard', 'work-order-cost'];
    const unrelated = ['orgFeatures', 'ownPlan', 'companies', 'contacts', 'record-history', 'users'];
    const { qc } = await seeded([...dependents, ...unrelated]);
    await invalidateAfterOrgCostSetting(qc);
    for (const r of dependents) expect(qc.getQueryState([r, 'org-1'])!.isInvalidated, r).toBe(true);
    for (const r of unrelated) expect(qc.getQueryState([r, 'org-1'])!.isInvalidated, r).toBe(false);
  });

  it('refetches only the active dependents: one read each, none for unrelated active reads', async () => {
    const qc = new QueryClient();
    const dep = vi.fn().mockResolvedValue(1);
    const other = vi.fn().mockResolvedValue(1);
    const o1 = qc.getQueryCache().build(qc, { queryKey: ['procurements', 'org-1'], queryFn: dep });
    const o2 = qc.getQueryCache().build(qc, { queryKey: ['companies', 'org-1'], queryFn: other });
    const { QueryObserver } = await import('@tanstack/react-query');
    const w1 = new QueryObserver(qc, { queryKey: ['procurements', 'org-1'], queryFn: dep });
    const w2 = new QueryObserver(qc, { queryKey: ['companies', 'org-1'], queryFn: other });
    const u1 = w1.subscribe(() => {}); const u2 = w2.subscribe(() => {});
    await vi.waitFor(() => expect(dep).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(other).toHaveBeenCalledTimes(1));
    await invalidateAfterOrgCostSetting(qc);
    expect(dep).toHaveBeenCalledTimes(2);
    expect(other).toHaveBeenCalledTimes(1);
    u1(); u2(); void o1; void o2;
  });

  it('never exempts a stock, money, procurement, budget, work-order or ledger root', () => {
    const risky = /stock|money|procure|budget|finance|financial|invoice|payment|revenue|cost|work-order|odoo|erp|ledger|dashboard|billing|claim|expense|imprest|timesheet|equipment/;
    for (const r of UNAFFECTED_BY_COST_SETTINGS) expect(risky.test(r), r).toBe(false);
  });
});
