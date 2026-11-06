import { describe, expect, it } from 'vitest';
import { deriveActualPosition, deriveBudgetConsumption } from '@/src/lib/projectFinances';
import { buildBudgetSummaryRows, committedTotal } from '../budgetModel';

/**
 * #1739 / AC-PFE-005 — the Projects list and the Budget tab split ONE purchase the same way.
 *
 * The payloads below are what the 0700 read returns for a no-ERP org with a single half-paid 1,000 purchase:
 * the collection carries 500 spent + 500 committed, the budget tab's actuals carry 500 per category and its
 * commitments carry the server's open commitment of 500.
 */
const halfPaidCollection = {
  ledgerBasis: 'pmo' as const,
  actuals: {
    currency: 'USD', total: '500.00', asOf: null, excludesRestrictedRows: false, complete: true,
    committedTotal: '500.00', committedComplete: true, categories: [],
  },
  activeBudgetAmount: '5000', activeBudgetCurrency: 'USD', hasActiveBudget: true,
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

  it('AC-1739-05: budget consumption (spent + committed) stays the whole order total for the list column', () => {
    const consumption = deriveBudgetConsumption({
      ledgerBasis: 'pmo',
      spent: halfPaidCollection.actuals.total,
      committed: halfPaidCollection.actuals.committedTotal,
      spentComplete: halfPaidCollection.actuals.complete,
      committedComplete: halfPaidCollection.actuals.committedComplete,
    });
    const budget = budgetTab();
    expect(consumption).toEqual({ amount: '1000.00', complete: true });
    expect(Number(consumption.amount)).toBe((budget.spent ?? 0) + (budget.committed ?? 0));
  });

  it('AC-1739-05: an unreadable part withholds consumption instead of printing a partial sum', () => {
    expect(deriveBudgetConsumption({
      ledgerBasis: 'pmo', spent: '500.00', committed: '500.00', spentComplete: true, committedComplete: false,
    })).toEqual({ amount: null, complete: false });
    expect(deriveBudgetConsumption({
      ledgerBasis: 'pmo', spent: null, committed: '500.00', spentComplete: false, committedComplete: true,
    })).toEqual({ amount: null, complete: false });
  });

  it('AC-1739-07: an ERP-ledger org consumes its ledger Actual only (no PMO commitment added)', () => {
    expect(deriveBudgetConsumption({
      ledgerBasis: 'erp', spent: '300.00', committed: null, spentComplete: true,
    })).toEqual({ amount: '300.00', complete: true });
  });

  it('AC-1739-02: pre-0700 payloads without a committed figure still read their (total) Actual', () => {
    expect(deriveBudgetConsumption({
      ledgerBasis: 'pmo', spent: '950', spentComplete: true,
    })).toEqual({ amount: '950.00', complete: true });
  });
});
