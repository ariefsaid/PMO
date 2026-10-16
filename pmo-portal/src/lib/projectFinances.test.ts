import { describe, expect, it } from 'vitest';
import { deriveActualPosition, deriveContractRemainingAfterCost, deriveContractRemainingFromPosition, deriveMargin, formatExactMoney, formatSignedExactMoney, hasCompleteActuals, isActualComplete, isProjectFinances, moneyText, moneyUnits } from './projectFinances';
import { isMoneyAtRisk } from './dashboardConstants';

describe('money completeness and risk consistency', () => {
  const categories = [
    { category: 'Labor', mapped: true, amount: '10.00' },
    { category: 'Materials', mapped: false, amount: null },
  ];

  it('requires every budgeted ERP category, but PO-basis completeness is successful read', () => {
    const actuals = { currency: 'IDR', as_of: null, total: '10.00', excludes_restricted_rows: false, categories };
    expect(isActualComplete({ basis: 'erp', readSucceeded: true, actuals, budgetedCategories: ['Labor', 'Materials'] })).toBe(false);
    expect(isActualComplete({ basis: 'erp', readSucceeded: true, actuals, budgetedCategories: ['Labor'] })).toBe(true);
    expect(isActualComplete({ basis: 'erp', readSucceeded: true, categories: [] })).toBe(false);
    expect(isActualComplete({ basis: 'erp', readSucceeded: true, coverageCount: 0, coverageTotal: 0 })).toBe(false);
    expect(isActualComplete({ basis: 'pmo', readSucceeded: true })).toBe(true);
    expect(isActualComplete({ basis: 'pmo', readSucceeded: false })).toBe(false);
  });

  it.each([
    [{ status: 'Ongoing Project', budget: 100, budgetCurrency: 'USD', projectCurrency: 'USD', spent: 90, actualCurrency: 'USD', actualComplete: true }, true],
    [{ status: 'Ongoing Project', budget: 100, budgetCurrency: 'USD', projectCurrency: 'USD', spent: 90, actualCurrency: 'IDR', actualComplete: true }, false],
    [{ status: 'Ongoing Project', budget: 100, budgetCurrency: 'USD', projectCurrency: 'IDR', spent: 90, actualCurrency: 'USD', actualComplete: true }, false],
    [{ status: 'Ongoing Project', budget: 100, budgetCurrency: 'USD', projectCurrency: 'USD', spent: 90, actualCurrency: 'USD', actualComplete: false }, false],
    [{ status: 'Ongoing Project', budget: 0, budgetCurrency: 'USD', projectCurrency: 'USD', spent: 0, actualCurrency: 'USD', actualComplete: true }, false],
    [{ status: 'Close Out', budget: 100, budgetCurrency: 'USD', projectCurrency: 'USD', spent: 99, actualCurrency: 'USD', actualComplete: true }, false],
    [{ status: 'Ongoing Project', budget: 100, budgetCurrency: 'USD', projectCurrency: 'USD', spent: 89.99, actualCurrency: 'USD', actualComplete: true }, false],
    [{ status: 'Won, Pending KoM', budget: 100, budgetCurrency: 'USD', projectCurrency: 'USD', spent: 95, actualCurrency: 'USD', actualComplete: true }, true],
    [{ status: 'On Hold', budget: 100, budgetCurrency: 'USD', projectCurrency: 'USD', spent: 95, actualCurrency: 'USD', actualComplete: true }, true],
  ] as const)('applies one at-risk truth table', (input, expected) => expect(isMoneyAtRisk(input)).toBe(expected));
});

describe('exact project-finance money', () => {
  it('AC-PFIN-013 subtracts scale-2 amounts without floating-point drift', () => {
    const revenue = moneyUnits('0.30');
    const cost = moneyUnits('0.10');
    expect(revenue).not.toBeNull();
    expect(cost).not.toBeNull();
    expect(moneyText(revenue! - cost!)).toBe('0.20');
  });

  it('AC-PFIN-013 preserves amounts beyond JavaScript safe integer precision', () => {
    expect(moneyText(moneyUnits('9007199254740993.99')!)).toBe('9007199254740993.99');
  });

  it.each([null, 'NaN', 'Infinity', '-Infinity', '', '1.234', '1.', '.25', '--1', ' 1']) (
    'AC-PFIN-013 rejects invalid or unsupported exact money input %s', (value) => {
      expect(moneyUnits(value)).toBeNull();
    },
  );

  it('AC-PFIN-013 formats negative minor-unit values with a stable scale', () => {
    expect(moneyText(-1n)).toBe('-0.01');
    expect(moneyText(-12345n)).toBe('-123.45');
  });

  it('AC-PFIN-013 formats large exact amounts with localized cents and preserved precision', () => {
    expect(formatExactMoney('9007199254740993.99', 'USD', 'en-US')).toBe('$9,007,199,254,740,993.99');
    expect(formatExactMoney('100.25', 'USD', 'id-ID')).toBe('US$100,25');
  });

  it('AC-PFIN-015 returns unavailable for invalid money, currency, or locale', () => {
    expect(formatExactMoney('bad', 'USD', 'en-US')).toBeNull();
    expect(formatExactMoney('1.00', 'usd', 'en-US')).toBeNull();
    expect(formatExactMoney('1.00', 'USD', 'not_a_locale')).toBeNull();
  });

  it('AC-PFIN-015 validates a complete project-finance payload including nullable readings', () => {
    const valid = {
      project_id: '02900000-0000-0000-0000-000000000001',
      contract_invoiced: null,
      remaining_to_invoice: null,
      invoices: [{ currency: 'USD', invoice_count: 1, invoiced: '10.00', settled: null,
        outstanding: null, missing_amount: 0, missing_outstanding: 1, missing_work: 0,
        tax_basis: 'inclusive', work_revenue: null }],
      budget: { id: '02900000-0000-0000-0000-000000000002', name: 'Budget', version: 1,
        status: 'Active', currency: 'USD', amount: '10.00' },
      actuals: { currency: 'USD', as_of: '2026-10-01T00:00:00Z', total: null,
        excludes_restricted_rows: false, categories: [{ category: 'Labor', mapped: true, amount: null }] },
    };
    expect(isProjectFinances(valid)).toBe(true);
    expect(isProjectFinances({ ...valid, budget: null,
      actuals: { currency: null, as_of: null, total: null, excludes_restricted_rows: true, categories: [] } })).toBe(true);
  });

  it.each([
    null,
    [],
    { project_id: '02900000-0000-0000-0000-000000000001', invoices: [], budget: null },
    { project_id: '02900000-0000-0000-0000-000000000001', contract_invoiced: 10, remaining_to_invoice: null,
      invoices: [], budget: null, actuals: { currency: null, as_of: null, total: null, excludes_restricted_rows: false, categories: [] } },
    { project_id: '02900000-0000-0000-0000-000000000001', contract_invoiced: null, remaining_to_invoice: null,
      invoices: [], budget: { id: '02900000-0000-0000-0000-000000000002', name: 'Budget', version: 1,
        status: 'Archived', currency: 'USD', amount: null },
      actuals: { currency: null, as_of: null, total: null, excludes_restricted_rows: false, categories: [] } },
  ])('AC-PFIN-015 rejects malformed top-level project-finance data', (value) => {
    expect(isProjectFinances(value)).toBe(false);
  });

  it('DD-MONEY-2 derives contract remaining after cost with exact minor-unit arithmetic', () => {
    const actuals = { currency: 'USD', as_of: null, total: '0.10', excludes_restricted_rows: false,
      categories: [{ category: 'Labor', mapped: true, amount: '0.10' }] };
    const remaining = deriveContractRemainingAfterCost(0.30, actuals, 'USD');
    expect(remaining).toBe('0.20');
    expect(formatSignedExactMoney(deriveContractRemainingAfterCost(0.10, { ...actuals, total: '0.30' }, 'USD')!, 'USD', 'en-US'))
      .toBe('−$0.20');
    expect(deriveContractRemainingAfterCost(0.30, { ...actuals, total: null }, 'USD')).toBeNull();
  });

  it('UX-023 treats known zero as complete but rejects missing, partial, or restricted Actuals', () => {
    const actuals = { currency: 'USD', as_of: null, total: '0.00', excludes_restricted_rows: false,
      categories: [{ category: 'Labor', mapped: true, amount: '0.00' }] };
    expect(hasCompleteActuals(actuals)).toBe(true);
    expect(hasCompleteActuals({ ...actuals, categories: [] })).toBe(false);
    expect(hasCompleteActuals({ ...actuals, total: null })).toBe(false);
    expect(hasCompleteActuals({ ...actuals, categories: [...actuals.categories, { category: 'Materials', mapped: false, amount: null }] })).toBe(false);
    expect(hasCompleteActuals({ ...actuals, excludes_restricted_rows: true })).toBe(false);
  });

  it('DD-MONEY-1 selects Actual from ledger ownership, independent of procurement ownership', () => {
    const actuals = { currency: 'USD', as_of: '2026-10-01T00:00:00Z', total: '50.00',
      excludes_restricted_rows: false, categories: [{ category: 'Labor', mapped: true, amount: '50.00' }] };
    expect(deriveActualPosition({ ledgerBasis: 'erp', committedSpend: 125, commitmentPending: false, commitmentError: false, projectCurrency: 'IDR', actuals }))
      .toMatchObject({ amount: '50.00', currency: 'USD', basis: 'erp' });
    expect(deriveActualPosition({ ledgerBasis: 'pmo', committedSpend: 125, commitmentPending: false, commitmentError: false, projectCurrency: 'IDR', actuals }))
      .toMatchObject({ amount: '125.00', currency: 'IDR', basis: 'pmo' });
    expect(deriveActualPosition({ ledgerBasis: 'erp', committedSpend: undefined, commitmentPending: false, commitmentError: false, projectCurrency: 'IDR', actuals }))
      .toMatchObject({ amount: '50.00', basis: 'erp' });
    expect(deriveContractRemainingFromPosition(100, { amount: '50.00', currency: 'USD' }, 'IDR')).toBeNull();
  });

  it('DD-MONEY-1 withholds Actual while its selected source is loading or failed', () => {
    const actuals = { currency: null, as_of: null, total: null, excludes_restricted_rows: false, categories: [] };
    expect(deriveActualPosition({ ledgerBasis: 'pmo', committedSpend: undefined, commitmentPending: true, commitmentError: false, projectCurrency: 'IDR', actuals }).amount).toBeNull();
    expect(deriveActualPosition({ ledgerBasis: 'pmo', committedSpend: undefined, commitmentPending: false, commitmentError: true, projectCurrency: 'IDR', actuals }).amount).toBeNull();
    expect(deriveActualPosition({ ledgerBasis: 'unavailable', committedSpend: 125, commitmentPending: false, commitmentError: false, projectCurrency: 'IDR', actuals }))
      .toMatchObject({ amount: null, basis: 'unavailable', complete: false });
  });

  it('AC-PFIN-013 derives a same-currency margin from billed work and mapped costs only', () => {
    const invoice = { currency: 'USD', invoice_count: 1, invoiced: '150.00', settled: null, outstanding: null,
      missing_amount: 0, missing_outstanding: 1, tax_basis: 'inclusive' as const, work_revenue: '130.00', missing_work: 0 };
    const actuals = { currency: 'USD', as_of: '2026-10-01T00:00:00Z', total: '50.00',
      excludes_restricted_rows: false, categories: [{ category: 'Labor', mapped: true, amount: '50.00' }] };
    expect(deriveMargin(invoice, actuals)).toEqual({ amount: '80.00', reason: null });
    expect(deriveMargin(invoice, { ...actuals, categories: [] })).toEqual({ amount: null, reason: 'actuals-unavailable' });
    expect(deriveMargin(invoice, { ...actuals, categories: [{ category: 'Materials', mapped: false, amount: null }] }))
      .toEqual({ amount: null, reason: 'actuals-unavailable' });
  });

  it('AC-PFIN-013 withholds margins for currency mismatch or incomplete work and actuals', () => {
    const invoice = { currency: 'IDR', invoice_count: 1, invoiced: '100.00', settled: null, outstanding: null,
      missing_amount: 0, missing_outstanding: 1, tax_basis: 'inclusive' as const, work_revenue: '130.00', missing_work: 0 };
    const actuals = { currency: 'USD', as_of: null, total: '50.00', excludes_restricted_rows: false,
      categories: [{ category: 'Labor', mapped: true, amount: '50.00' }] };
    expect(deriveMargin(invoice, actuals)).toEqual({ amount: null, reason: 'different-currencies' });
    expect(deriveMargin({ ...invoice, currency: 'USD', work_revenue: null }, actuals))
      .toEqual({ amount: null, reason: 'work-unavailable' });
    expect(deriveMargin({ ...invoice, currency: 'USD', missing_work: 1 }, actuals))
      .toEqual({ amount: null, reason: 'work-unavailable' });
    expect(deriveMargin({ ...invoice, currency: 'USD' }, { ...actuals, total: null }))
      .toEqual({ amount: null, reason: 'actuals-unavailable' });
    expect(deriveMargin({ ...invoice, currency: 'USD' }, { ...actuals, currency: null }))
      .toEqual({ amount: null, reason: 'actuals-unavailable' });
    expect(deriveMargin({ ...invoice, currency: 'USD' }, { ...actuals, excludes_restricted_rows: true }))
      .toEqual({ amount: null, reason: 'restricted-rows' });
  });

  it('AC-PFIN-015 rejects non-integer counts, non-string money, and malformed categories', () => {
    const valid = {
      project_id: '02900000-0000-0000-0000-000000000001', contract_invoiced: null, remaining_to_invoice: null,
      invoices: [{ currency: 'USD', invoice_count: 1, invoiced: '10.00', settled: null, outstanding: null,
        missing_amount: 0, missing_outstanding: 0, missing_work: 0, tax_basis: 'inclusive', work_revenue: null }],
      budget: null,
      actuals: { currency: null, as_of: null, total: null, excludes_restricted_rows: false,
        categories: [{ category: 'Labor', mapped: true, amount: null }] },
    };
    expect(isProjectFinances({ ...valid, invoices: [{ ...valid.invoices[0], invoice_count: 1.5 }] })).toBe(false);
    expect(isProjectFinances({ ...valid, invoices: [{ ...valid.invoices[0], invoiced: 10 }] })).toBe(false);
    expect(isProjectFinances({ ...valid, actuals: { ...valid.actuals, categories: [{ category: 1, mapped: true, amount: null }] } })).toBe(false);
  });
});
