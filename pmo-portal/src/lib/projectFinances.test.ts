import { describe, expect, it } from 'vitest';
import { deriveMargin, formatExactMoney, isProjectFinances, moneyText, moneyUnits } from './projectFinances';

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
      project_id: '02870000-0000-0000-0000-000000000001',
      contract_invoiced: null,
      remaining_to_invoice: null,
      invoices: [{ currency: 'USD', invoice_count: 1, invoiced: '10.00', settled: null,
        outstanding: null, missing_amount: 0, missing_outstanding: 1, missing_work: 0,
        tax_basis: 'inclusive', work_revenue: null }],
      budget: { id: '02870000-0000-0000-0000-000000000002', name: 'Budget', version: 1,
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
    { project_id: '02870000-0000-0000-0000-000000000001', invoices: [], budget: null },
    { project_id: '02870000-0000-0000-0000-000000000001', contract_invoiced: 10, remaining_to_invoice: null,
      invoices: [], budget: null, actuals: { currency: null, as_of: null, total: null, excludes_restricted_rows: false, categories: [] } },
    { project_id: '02870000-0000-0000-0000-000000000001', contract_invoiced: null, remaining_to_invoice: null,
      invoices: [], budget: { id: '02870000-0000-0000-0000-000000000002', name: 'Budget', version: 1,
        status: 'Archived', currency: 'USD', amount: null },
      actuals: { currency: null, as_of: null, total: null, excludes_restricted_rows: false, categories: [] } },
  ])('AC-PFIN-015 rejects malformed top-level project-finance data', (value) => {
    expect(isProjectFinances(value)).toBe(false);
  });

  it('AC-PFIN-013 derives a same-currency margin from billed work and mapped costs only', () => {
    const invoice = { currency: 'USD', invoice_count: 1, invoiced: '150.00', settled: null, outstanding: null,
      missing_amount: 0, missing_outstanding: 1, tax_basis: 'inclusive' as const, work_revenue: '130.00', missing_work: 0 };
    const actuals = { currency: 'USD', as_of: '2026-10-01T00:00:00Z', total: '50.00',
      excludes_restricted_rows: false, categories: [] };
    expect(deriveMargin(invoice, actuals)).toEqual({ amount: '80.00', reason: null });
  });

  it('AC-PFIN-013 withholds margins for currency mismatch or incomplete work and actuals', () => {
    const invoice = { currency: 'IDR', invoice_count: 1, invoiced: '100.00', settled: null, outstanding: null,
      missing_amount: 0, missing_outstanding: 1, tax_basis: 'inclusive' as const, work_revenue: '130.00', missing_work: 0 };
    const actuals = { currency: 'USD', as_of: null, total: '50.00', excludes_restricted_rows: false, categories: [] };
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
      project_id: '02870000-0000-0000-0000-000000000001', contract_invoiced: null, remaining_to_invoice: null,
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
