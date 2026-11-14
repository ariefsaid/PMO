import { describe, expect, it } from 'vitest';
import { deriveActualPosition, deriveBudgetConsumption, projectBudgetSpentPercent } from '@/src/lib/projectFinances';
import type { CanonicalBudgetReading } from '@/src/lib/db/projectMoney';
import { buildBudgetSummaryRows, committedTotal } from '@/src/lib/budget/budgetModel';

/**
 * #1739 / AC-PFE-005 — the Projects list and the Budget tab split ONE purchase the same way.
 *
 * The payloads below mirror what the 0700 read returns for a no-ERP org with a single half-paid 1,000 purchase. They
 * are NOT the proof that the server agrees with itself: that is supabase/tests/0700_pmo_spend_split.test.sql AC-1739-02,
 * which drives the real collection and the real project-finances read, pins the committed figure to the Budget tab's
 * per-purchase open commitments, and pins the exact payload keys mirrored here. This file proves the client derivations
 * (what the list and the Budget tab show for that payload) agree.
 */
const halfPaidCollection = {
  ledgerBasis: 'pmo' as const,
  actuals: {
    currency: 'USD', total: '500.00', asOf: null, excludesRestrictedRows: false, complete: true,
    committedTotal: '500.00', committedComplete: true, categories: [],
  },
  activeBudgetAmount: '5000', activeBudgetCurrency: 'USD', hasActiveBudget: true,
};
const halfPaidPosition: CanonicalBudgetReading = {
  projectId: 'p1', ledgerBasis: 'pmo', currency: 'USD', budgetCurrency: 'USD', activeBudgetAmount: '5000',
  spent: '500.00', openCommitment: '500.00', consumption: '1000.00', complete: true,
  usedRatio: '0.2', usedPercent: '20', consumptionVariance: '-4000.00', riskEligible: true, atRisk: false,
};

const budgetTab = (overrides: { actual?: number | null; committed?: number | null } = {}) => {
  const rows = buildBudgetSummaryRows({
    lines: [{ category: 'Labor', description: null, budgeted_amount: 5000 }],
    actuals: [{ category: 'Labor', budget: 5000, actual: overrides.actual === undefined ? 500 : overrides.actual }],
    procurements: [{
      status: 'Paid', budget_category: 'Labor', approved_total_value: 1000, total_value: 1000, currency: 'USD',
      open_commitment: overrides.committed === undefined ? 500 : overrides.committed,
    }],
    canReadProcurements: true,
    currency: 'USD',
  });
  return { rows, spent: rows[0]?.spent ?? null, committed: committedTotal(rows) };
};

describe('#1739 the Projects list and the Budget tab agree on a half-paid purchase', () => {
  it('projects recorded spend as a distinct exact percentage of the before-tax active budget', () => {
    expect(projectBudgetSpentPercent(halfPaidPosition)).toBe(10);
    expect(projectBudgetSpentPercent({ ...halfPaidPosition, spent: '9007199254740993.99', activeBudgetAmount: '18014398509481987.98' })).toBe(50);
    expect(projectBudgetSpentPercent({ ...halfPaidPosition, currency: 'EUR' })).toBeNull();
    expect(projectBudgetSpentPercent({ ...halfPaidPosition, activeBudgetAmount: '0.00' })).toBeNull();
  });

  it('AC-1739-02: both screens read the same half-paid 1,000 purchase as 500 spent (never 1,000 actual)', () => {
    const listActual = deriveActualPosition({
      ledgerBasis: 'pmo',
      pmoSpent: halfPaidCollection.actuals.total,
      pmoSpentPending: false,
      pmoSpentError: false,
      pmoSpentComplete: halfPaidCollection.actuals.complete,
      projectCurrency: 'USD',
      actuals: undefined,
    });
    const budget = budgetTab();

    expect(listActual.amount).toBe('500.00');
    expect(budget.spent).toBe(500);
    expect(Number(listActual.amount)).toBe(budget.spent);
  });

  it('AC-1739-02: the unpaid remainder is the Budget tab Committed figure, not part of Actual', () => {
    const budget = budgetTab();
    expect(budget.committed).toBe(500);
    // spent + committed is the order total: the purchase is never counted twice.
    expect((budget.spent ?? 0) + (budget.committed ?? 0)).toBe(1000);
  });

  it('AC-1739-05: budget consumption reads the canonical whole order total', () => {
    const consumption = deriveBudgetConsumption(halfPaidPosition);
    const budget = budgetTab();
    expect(consumption).toEqual({ amount: '1000.00', complete: true });
    expect(Number(consumption.amount)).toBe((budget.spent ?? 0) + (budget.committed ?? 0));
  });

  it('AC-1739-05: an incomplete canonical reading withholds consumption', () => {
    expect(deriveBudgetConsumption({ ...halfPaidPosition, consumption: null, complete: false })).toEqual({ amount: null, complete: false });
  });

  it('AC-1739-07: an ERP-ledger org consumes its ledger Actual only (no PMO commitment added)', () => {
    expect(deriveBudgetConsumption({ ...halfPaidPosition, ledgerBasis: 'erp', spent: '300.00', openCommitment: null, consumption: '300.00' }))
      .toEqual({ amount: '300.00', complete: true });
  });

  it('AC-1739-05: a missing canonical position stays unknown', () => {
    expect(deriveBudgetConsumption(undefined)).toEqual({ amount: null, complete: false });
  });
});
