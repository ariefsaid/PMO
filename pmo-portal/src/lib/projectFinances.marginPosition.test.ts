import { describe, expect, it } from 'vitest';
import {
  deriveMargin,
  type CanonicalMarginCoverage,
  type InvoiceFinanceBucket,
  type ProjectFinances,
} from './projectFinances';

const work: InvoiceFinanceBucket = {
  currency: 'USD',
  invoice_count: 1,
  invoiced: '100.00',
  settled: '0.00',
  outstanding: '100.00',
  missing_amount: 0,
  missing_outstanding: 0,
  tax_basis: 'inclusive',
  work_revenue: '100.00',
  missing_work: 0,
};

function actuals(overrides: Partial<ProjectFinances['actuals']> = {}): ProjectFinances['actuals'] {
  return {
    currency: 'USD',
    as_of: '2026-10-18T00:00:00Z',
    total: '0.00',
    excludes_restricted_rows: false,
    categories: [],
    ...overrides,
  };
}

const completePmoRead: CanonicalMarginCoverage = {
  basis: 'pmo',
  readSucceeded: true,
  complete: true,
};

describe('deriveMargin for current project position', () => {
  it.each([
    ['known zero cost', '0.00', '100.00'],
    ['known PMO cost', '50.00', '50.00'],
    ['cost above billed work', '125.00', '-25.00'],
  ])('AC-S35-002: derives %s from billed work and canonical Actual exactly', (_label, cost, margin) => {
    expect(deriveMargin(work, actuals({ total: cost }), completePmoRead))
      .toEqual({ amount: margin, reason: null });
  });

  it('AC-S35-002: preserves exact margin arithmetic beyond JavaScript safe integers', () => {
    const largeWork = { ...work, work_revenue: '9007199254740993.99' };
    expect(deriveMargin(largeWork, actuals({ total: '0.01' }), completePmoRead))
      .toEqual({ amount: '9007199254740993.98', reason: null });
  });

  it('AC-S35-002: keeps a PMO Actual unavailable until its canonical read is complete', () => {
    expect(deriveMargin(work, actuals({ total: '50.00' }), {
      basis: 'pmo',
      readSucceeded: false,
      complete: true,
    })).toEqual({ amount: null, reason: 'actuals-unavailable' });
    expect(deriveMargin(work, actuals({ total: '50.00' }), {
      ...completePmoRead,
      complete: false,
    })).toEqual({ amount: null, reason: 'actuals-unavailable' });
  });

  it('AC-S35-002: honors canonical ERP coverage while retaining the restricted-row guard', () => {
    const completeErp: CanonicalMarginCoverage = { basis: 'erp', readSucceeded: true, complete: true };
    expect(deriveMargin(work, actuals({ total: '50.00' }), completeErp))
      .toEqual({ amount: '50.00', reason: null });
    expect(deriveMargin(work, actuals({ total: '50.00' }), { ...completeErp, complete: false }))
      .toEqual({ amount: null, reason: 'actuals-unavailable' });
    expect(deriveMargin(work, actuals({ total: '50.00', excludes_restricted_rows: true }), completeErp))
      .toEqual({ amount: null, reason: 'restricted-rows' });
  });

  it('AC-S35-002: withholds incomparable or malformed canonical Actuals without substituting zero', () => {
    expect(deriveMargin(work, actuals({ total: '50.00', currency: 'EUR' }), completePmoRead))
      .toEqual({ amount: null, reason: 'different-currencies' });
    expect(deriveMargin(work, actuals({ total: null }), completePmoRead))
      .toEqual({ amount: null, reason: 'actuals-unavailable' });
    expect(deriveMargin(work, actuals({ total: 'NaN' }), completePmoRead))
      .toEqual({ amount: null, reason: 'actuals-unavailable' });
    expect(deriveMargin(work, actuals({ currency: null }), completePmoRead))
      .toEqual({ amount: null, reason: 'actuals-unavailable' });
  });

  it('AC-S35-002 preserves the legacy two-argument category completeness contract', () => {
    expect(deriveMargin(work, actuals({ total: '50.00' })))
      .toEqual({ amount: null, reason: 'actuals-unavailable' });
    expect(deriveMargin(work, actuals({
      total: '50.00',
      categories: [{ category: 'Labor', mapped: true, amount: '50.00' }],
    }))).toEqual({ amount: '50.00', reason: null });
  });
});
