import { describe, expect, it } from 'vitest';
import { atRiskCount, projectAtRisk, projectBudgetUsagePct, projectRiskBasisKnown } from '../metrics';
import type { PMDashboardProject } from '@/src/lib/db/dashboard';
import type { CanonicalBudgetReading } from '@/src/lib/db/projectMoney';

const project = (over: Partial<PMDashboardProject>): PMDashboardProject => ({
  id: 'p1', status: 'Ongoing Project', currency: 'USD', contract_value: 100, client_name: null,
  contract_remaining: null, realized_margin_pct: null, budget: 100, budget_currency: 'USD', spent: 10,
  actual_currency: 'USD', actual_complete: true, ...over,
} as PMDashboardProject);
const reading = (projectId: string, atRisk: boolean | null, usedPercent: string | null = '90'): CanonicalBudgetReading => ({
  projectId, ledgerBasis: 'pmo', currency: 'USD', budgetCurrency: 'USD', activeBudgetAmount: '100', spent: '50',
  openCommitment: '40', consumption: atRisk === null ? null : '90', complete: atRisk !== null,
  usedRatio: atRisk === null ? null : '0.9', usedPercent: atRisk === null ? null : usedPercent,
  consumptionVariance: atRisk === null ? null : '-10', riskEligible: true, atRisk,
});

describe('atRiskCount', () => {
  it('counts known at-risk projects exactly when every basis is known', () => {
    expect(atRiskCount([project({ id: 'p1' }), project({ id: 'p2' })], { p1: reading('p1', true), p2: reading('p2', false) })).toEqual({ count: 1, partial: false });
  });

  it('reports a floor when some projects are unknown but at least one is known to be at risk', () => {
    expect(atRiskCount([project({ id: 'p1' }), project({ id: 'p2' })], { p1: reading('p1', true), p2: reading('p2', null) })).toEqual({ count: 1, partial: true });
  });

  it('is unknown when no project is known at risk and some are unknown', () => {
    expect(atRiskCount([project({ id: 'p1' }), project({ id: 'p2' })], { p1: reading('p1', false), p2: reading('p2', null) })).toBeNull();
  });

  it('uses the reader percentage and risk decision without recomputing from spend', () => {
    const canonical = reading('p1', true, '90');
    expect(projectBudgetUsagePct(canonical)).toBe(90);
    expect(projectAtRisk(canonical)).toBe(true);
    expect(projectRiskBasisKnown(canonical)).toBe(true);
  });

  it('treats a cached reading from another project currency as unknown', () => {
    const canonical = reading('p1', true, '90');
    expect(projectBudgetUsagePct(canonical, 'IDR')).toBeNull();
    expect(projectAtRisk(canonical, 'IDR')).toBe(false);
    expect(projectRiskBasisKnown(canonical, 'IDR')).toBe(false);
    expect(atRiskCount([project({ id: 'p1', currency: 'IDR' })], { p1: canonical })).toBeNull();
  });
});
