import { describe, expect, it } from 'vitest';
import { projectRecordedSpent } from '@/src/lib/projectFinances';
import type { CanonicalBudgetReading } from '@/src/lib/db/projectMoney';
import type { TopProject } from '@/src/lib/db/dashboard';
import { withRecordedSpend } from './recordedSpend';

const reading = (over: Partial<CanonicalBudgetReading> = {}): CanonicalBudgetReading => ({
  projectId: 'p1', ledgerBasis: 'pmo', currency: 'USD', budgetCurrency: 'USD', activeBudgetAmount: '1000.00', spent: '300.00',
  openCommitment: '0.00', consumption: '300.00', complete: true, usedRatio: '0.3', usedPercent: '30', consumptionVariance: '-700.00',
  riskEligible: true, atRisk: false, ...over,
});
const project = (over: Partial<TopProject> = {}): TopProject => ({
  id: 'p1', name: 'River', currency: 'USD', contract_value: 2000, budget: 1000, spent: 900, actual_complete: true, actual_currency: 'USD',
  status: 'Ongoing Project', ...over,
} as TopProject);

describe('projectRecordedSpent (the Budget tab Spent rule)', () => {
  it('is the canonical spent in the project currency', () => {
    expect(projectRecordedSpent(reading(), 'USD')).toBe(300);
  });
  it('is unknown when there is no reading, no spent, or spent in another currency', () => {
    expect(projectRecordedSpent(undefined, 'USD')).toBeNull();
    expect(projectRecordedSpent(reading({ spent: null }), 'USD')).toBeNull();
    expect(projectRecordedSpent(reading({ currency: 'IDR' }), 'USD')).toBeNull();
  });
  it('a recorded zero stays a known zero', () => {
    expect(projectRecordedSpent(reading({ spent: '0.00' }), 'USD')).toBe(0);
  });
});

describe('withRecordedSpend: dashboard rows take spending from the same reading as the Budget tab', () => {
  it('replaces the dashboard read with the Budget tab figure', () => {
    const [row] = withRecordedSpend([project()], { p1: reading() });
    expect(row).toMatchObject({ id: 'p1', spent: 300, actual_complete: true, actual_currency: 'USD' });
  });
  it('a project the Budget tab cannot state is unknown on the dashboard too, even when the dashboard read had a figure', () => {
    const [row] = withRecordedSpend([project()], { p1: reading({ spent: null }) });
    expect(row).toMatchObject({ spent: null, actual_complete: false });
    const [missing] = withRecordedSpend([project()], {});
    expect(missing).toMatchObject({ spent: null, actual_complete: false });
  });
});
