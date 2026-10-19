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

const mappedCategories: ProjectFinances['actuals']['categories'] = [
  { category: 'Labor', mapped: true, amount: '50.00' },
];

const completeErp: CanonicalMarginCoverage = { basis: 'erp', readSucceeded: true, complete: true };

describe('deriveMargin for current project position', () => {
  it.each([
    ['known zero cost', '0.00', '100.00'],
    ['known ERP cost', '50.00', '50.00'],
    ['cost above billed work', '125.00', '-25.00'],
  ])('AC-S35-002: derives %s from billed work and a complete ERP Actual exactly', (_label, cost, margin) => {
    expect(deriveMargin(work, actuals({ total: cost, categories: mappedCategories }), completeErp))
      .toEqual({ amount: margin, reason: null });
  });

  it('AC-S35-002: preserves exact margin arithmetic beyond JavaScript safe integers', () => {
    const largeWork = { ...work, work_revenue: '9007199254740993.99' };
    expect(deriveMargin(largeWork, actuals({ total: '0.01', categories: mappedCategories }), completeErp))
      .toEqual({ amount: '9007199254740993.98', reason: null });
  });

  it('AC-S35-002: withholds margin against PMO committed-PO cost even when the read is complete', () => {
    const pmoRead: CanonicalMarginCoverage = { basis: 'pmo', readSucceeded: true, complete: true };
    expect(deriveMargin(work, actuals({ total: '50.00', categories: mappedCategories }), pmoRead))
      .toEqual({ amount: null, reason: 'actuals-unavailable' });
    expect(deriveMargin(work, actuals({ total: '50.00', categories: mappedCategories }), { ...pmoRead, readSucceeded: false }))
      .toEqual({ amount: null, reason: 'actuals-unavailable' });
  });

  it('AC-S35-002: requires both the canonical ERP flag and every category mapped, keeping the restricted-row guard', () => {
    const complete = actuals({ total: '50.00', categories: mappedCategories });
    expect(deriveMargin(work, complete, completeErp)).toEqual({ amount: '50.00', reason: null });
    expect(deriveMargin(work, complete, { ...completeErp, complete: false }))
      .toEqual({ amount: null, reason: 'actuals-unavailable' });
    expect(deriveMargin(work, complete, { ...completeErp, readSucceeded: false }))
      .toEqual({ amount: null, reason: 'actuals-unavailable' });
    expect(deriveMargin(work, actuals({
      total: '50.00',
      categories: [...mappedCategories, { category: 'Materials', mapped: false, amount: null }],
    }), completeErp)).toEqual({ amount: null, reason: 'actuals-unavailable' });
    expect(deriveMargin(work, actuals({ total: '50.00', categories: [] }), completeErp))
      .toEqual({ amount: null, reason: 'actuals-unavailable' });
    expect(deriveMargin(work, actuals({ total: '50.00', categories: mappedCategories, excludes_restricted_rows: true }), completeErp))
      .toEqual({ amount: null, reason: 'restricted-rows' });
  });

  it('AC-S35-002: withholds incomparable or malformed canonical Actuals without substituting zero', () => {
    expect(deriveMargin(work, actuals({ total: '50.00', currency: 'EUR', categories: mappedCategories }), completeErp))
      .toEqual({ amount: null, reason: 'different-currencies' });
    expect(deriveMargin(work, actuals({ total: null, categories: mappedCategories }), completeErp))
      .toEqual({ amount: null, reason: 'actuals-unavailable' });
    expect(deriveMargin(work, actuals({ total: 'NaN', categories: mappedCategories }), completeErp))
      .toEqual({ amount: null, reason: 'actuals-unavailable' });
    expect(deriveMargin(work, actuals({ currency: null, categories: mappedCategories }), completeErp))
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
