/**
 * AC-RB-017 — wholeBudgetInputs: which readings feed "Left after this purchase" (OD-APPROVAL-LEFT).
 * Spending is the project header's reading; open orders come from the same row on PMO and from the
 * per-order position on ERP. `null` = open orders not known; `spent: null` = spending not known.
 */
import { describe, it, expect } from 'vitest';
import type { CanonicalBudgetReading } from '@/src/lib/db/projectMoney';
import { wholeBudgetInputs } from './wholeBudgetInputs';

const reading = (over: Partial<CanonicalBudgetReading> = {}): CanonicalBudgetReading => ({
  projectId: 'p1', ledgerBasis: 'pmo', currency: 'USD', budgetCurrency: 'USD', activeBudgetAmount: '1000.00',
  spent: '500.00', openCommitment: '400.00', consumption: null, complete: true, usedRatio: null, usedPercent: null,
  consumptionVariance: null, riskEligible: true, atRisk: false, ...over,
});
const committed = (over: { data?: number; otherCurrencies?: ReadonlyArray<unknown>; commitmentSource?: 'pmo' | 'not-tracked' | 'unavailable' } = {}) =>
  ({ data: 900, otherCurrencies: [], commitmentSource: 'pmo' as const, ...over });

describe('wholeBudgetInputs', () => {
  it('PMO reads open orders from the reading, never from the committed position (reading 400, committed 900 → 400)', () => {
    expect(wholeBudgetInputs(reading(), committed(), 'USD')).toEqual({ spent: 500, openOrders: 400 });
  });

  it('ERP reads open orders from the committed position', () => {
    expect(wholeBudgetInputs(reading({ ledgerBasis: 'erp', openCommitment: null }), committed({ data: 250 }), 'USD'))
      .toEqual({ spent: 500, openOrders: 250 });
  });

  it('open orders in another currency → not known (null), on either basis', () => {
    const other = [{ currency: 'EUR', amount: 5 }];
    expect(wholeBudgetInputs(reading({ ledgerBasis: 'erp' }), committed({ otherCurrencies: other }), 'USD')).toBeNull();
    expect(wholeBudgetInputs(reading(), committed({ otherCurrencies: other }), 'USD')).toBeNull();
  });

  it('PMO reading with no open commitment (an order without a total) → null', () => {
    expect(wholeBudgetInputs(reading({ openCommitment: null }), committed(), 'USD')).toBeNull();
  });

  it('purchasing kept outside PMO or ownership not read → null', () => {
    expect(wholeBudgetInputs(reading(), committed({ commitmentSource: 'not-tracked' }), 'USD')).toBeNull();
    expect(wholeBudgetInputs(reading(), committed({ commitmentSource: 'unavailable' }), 'USD')).toBeNull();
  });

  it('ERP with no committed position yet → null', () => {
    expect(wholeBudgetInputs(reading({ ledgerBasis: 'erp' }), committed({ data: undefined }), 'USD')).toBeNull();
  });

  it('spending not known keeps the open orders: spent null, never a zero', () => {
    expect(wholeBudgetInputs(reading({ spent: null }), committed(), 'USD')).toEqual({ spent: null, openOrders: 400 });
  });

  it('no reading (failed or absent) → spending not known; open orders from the committed position', () => {
    expect(wholeBudgetInputs(undefined, committed({ data: 900 }), 'USD')).toEqual({ spent: null, openOrders: 900 });
  });

  it('reading in another currency than the project → spending not known', () => {
    expect(wholeBudgetInputs(reading({ ledgerBasis: 'erp', currency: 'EUR' }), committed({ data: 250 }), 'USD'))
      .toEqual({ spent: null, openOrders: 250 });
  });

  it('a stub that omits commitmentSource is not treated as outside PMO', () => {
    expect(wholeBudgetInputs(reading(), { data: 900, otherCurrencies: [] }, 'USD')).toEqual({ spent: 500, openOrders: 400 });
  });
});
