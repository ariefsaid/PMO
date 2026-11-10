import { describe, expect, it } from 'vitest';
import { deriveActualPosition, deriveCollectionActual, deriveContractRemainingFromPosition, deriveMargin, formatExactMoney, formatSignedExactMoney, hasCompleteActuals, isActualComplete, isProjectFinances, moneyText, moneyUnits, parseContractExcess, parseProjectReceiptCash } from './projectFinances';
import type { ProjectMoneyRead } from './db/projectMoney';
import { getNumberLocale } from './locale/activeLocale';
import { isMoneyAtRisk } from './dashboardConstants';

// #2060: the collection Actual is the same derivation for the Cards view, the Table view and any
// other list surface. Its coverage verdict is the collection read's own `complete`; the category
// list it also carries enumerates the whole budget_category enum, so it can never be a coverage test.
describe('deriveCollectionActual (#2060 — one Actual for every collection surface)', () => {
  const money = (over: Partial<ProjectMoneyRead['actuals']> = {}, rest: Partial<ProjectMoneyRead> = {}): ProjectMoneyRead => ({
    ledgerBasis: 'erp',
    actuals: {
      currency: 'USD',
      total: '7200000.00',
      asOf: '2026-10-01T00:00:00Z',
      excludesRestrictedRows: false,
      complete: true,
      // The seeded shape: the org maps six of the enum's ten categories, so the list always carries
      // unmapped, amount-less rows even when the Active budget is fully covered.
      categories: [
        { category: 'Labor', mapped: true, amount: '7200000.00' },
        { category: 'Overheads', mapped: false, amount: null },
      ],
      ...over,
    },
    activeBudgetAmount: '6900000.00',
    activeBudgetCurrency: 'USD',
    hasActiveBudget: true,
    ...rest,
  });

  it('shows the figure when the collection read is complete, whatever the unmapped enum rows say', () => {
    const position = deriveCollectionActual({ projectCurrency: 'USD', money: money() });
    expect(position.state).toBe('available');
    expect(position.amount).toBe('7200000.00');
    expect(position.currency).toBe('USD');
    expect(position.text).toBe(formatExactMoney('7200000.00', 'USD', getNumberLocale(), { wholeUnits: true }));
  });

  it('withholds an incomplete reading and names the partial cause', () => {
    const position = deriveCollectionActual({ projectCurrency: 'USD', money: money({ complete: false }) });
    expect(position.state).toBe('partial');
    expect(position.text).toBeNull();
  });

  it('reports unknown, not partial, when nothing names a category gap', () => {
    const position = deriveCollectionActual({ projectCurrency: 'USD', money: money({ complete: false, categories: [] }) });
    expect(position.state).toBe('unknown');
    expect(position.text).toBeNull();
  });

  it('keeps a PMO position in another currency unknown rather than relabelling it', () => {
    const position = deriveCollectionActual({ projectCurrency: 'EUR', money: money({ currency: 'USD' }, { ledgerBasis: 'pmo' }) });
    expect(position.state).toBe('unknown');
    expect(position.text).toBeNull();
  });

  it('says nothing about a row whose collection read is pending or failed', () => {
    expect(deriveCollectionActual({ projectCurrency: 'USD', money: money(), moneyPending: true }).state).toBe('unavailable');
    expect(deriveCollectionActual({ projectCurrency: 'USD', money: money(), moneyError: true }).state).toBe('unavailable');
    expect(deriveCollectionActual({ projectCurrency: 'USD', money: undefined }).state).toBe('unavailable');
  });
});

describe('project receipt cash parser', () => {
  it('AC-UWC-009 preserves exact known zero and separate source-currency buckets', () => {
    expect(parseProjectReceiptCash({ state: 'known', buckets: [], receipt_count: 0 })).toEqual({
      state: 'known', buckets: [], receipt_count: 0,
    });
    expect(parseProjectReceiptCash({ state: 'known', buckets: [
      { currency: 'USD', amount: '12345678901234567890.01' },
      { currency: 'IDR', amount: '7.00' },
    ], receipt_count: 1001 })).toEqual({
      state: 'known', buckets: [
        { currency: 'USD', amount: '12345678901234567890.01' },
        { currency: 'IDR', amount: '7.00' },
      ], receipt_count: 1001,
    });
  });

  it('AC-UWC-009 accepts a recognized incomplete state without any amount bucket', () => {
    expect(parseProjectReceiptCash({ state: 'incomplete', buckets: [], receipt_count: 2,
      reasons: ['allocation-unreported', 'currency-mismatch'] })).toEqual({
      state: 'incomplete', buckets: [], receipt_count: 2,
      reasons: ['allocation-unreported', 'currency-mismatch'],
    });
  });

  it('AC-UWC-009 distinguishes an absent legacy field from a malformed present reading', () => {
    expect(parseProjectReceiptCash(undefined)).toEqual({ state: 'unavailable', buckets: [], reason: 'not-reported' });
    expect(parseProjectReceiptCash(null)).toEqual({ state: 'unavailable', buckets: [], reason: 'invalid-reading' });
  });

  it.each([
    { state: 'unknown', buckets: [], receipt_count: 0 },
    { state: 'known', buckets: [{ currency: 'USD', amount: '-0.01' }], receipt_count: 1 },
    { state: 'known', buckets: [{ currency: 'USD', amount: '-0.00' }], receipt_count: 1 },
    { state: 'known', buckets: [{ currency: 'usd', amount: '1.00' }], receipt_count: 1 },
    { state: 'known', buckets: [{ currency: 'USD', amount: 'NaN' }], receipt_count: 1 },
    { state: 'known', buckets: [{ currency: 'USD', amount: '1.00' }, { currency: 'USD', amount: '2.00' }], receipt_count: 2 },
    { state: 'known', buckets: [], receipt_count: Number.NaN },
    { state: 'known', buckets: [], receipt_count: 1.5 },
    { state: 'incomplete', buckets: [{ currency: 'USD', amount: '1.00' }], receipt_count: 1, reasons: ['allocation-invalid'] },
    { state: 'incomplete', buckets: [], receipt_count: 1, reasons: [] },
    { state: 'incomplete', buckets: [], receipt_count: 1, reasons: ['unknown-reason'] },
  ])('AC-UWC-009 rejects malformed or mixed receipt cash payloads %#', (value) => {
    expect(parseProjectReceiptCash(value)).toEqual({ state: 'unavailable', buckets: [], reason: 'invalid-reading' });
  });
});

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
    const remaining = deriveContractRemainingFromPosition(0.30, { amount: '0.10', currency: 'USD' }, 'USD');
    expect(remaining).toBe('0.20');
    expect(formatSignedExactMoney(deriveContractRemainingFromPosition(0.10, { amount: '0.30', currency: 'USD' }, 'USD')!, 'USD', 'en-US'))
      .toBe('$0');
    expect(deriveContractRemainingFromPosition(0.30, { amount: null, currency: 'USD' }, 'USD')).toBeNull();
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
    expect(deriveActualPosition({ ledgerBasis: 'erp', pmoSpent: 125, pmoSpentPending: false, pmoSpentError: false, projectCurrency: 'IDR', actuals }))
      .toMatchObject({ amount: '50.00', currency: 'USD', basis: 'erp' });
    expect(deriveActualPosition({ ledgerBasis: 'pmo', pmoSpent: 125, pmoSpentPending: false, pmoSpentError: false, projectCurrency: 'IDR', actuals }))
      .toMatchObject({ amount: '125.00', currency: 'IDR', basis: 'pmo' });
    expect(deriveActualPosition({ ledgerBasis: 'erp', pmoSpent: undefined, pmoSpentPending: false, pmoSpentError: false, projectCurrency: 'IDR', actuals }))
      .toMatchObject({ amount: '50.00', basis: 'erp' });
    expect(deriveContractRemainingFromPosition(100, { amount: '50.00', currency: 'USD' }, 'IDR')).toBeNull();
  });

  it('keeps a currency-incomplete PMO position unavailable for comparisons', () => {
    expect(isActualComplete({ basis: 'pmo', readSucceeded: true, complete: false })).toBe(false);
    expect(deriveActualPosition({ ledgerBasis: 'pmo', pmoSpent: 100, pmoSpentPending: false,
      pmoSpentError: false, pmoSpentComplete: false, projectCurrency: 'USD', actuals: undefined }))
      .toMatchObject({ amount: null, complete: false });
  });

  it('preserves exact project-currency totals from the collection', () => {
    expect(deriveActualPosition({ ledgerBasis: 'pmo', pmoSpent: '90071992547409.91', pmoSpentPending: false,
      pmoSpentError: false, projectCurrency: 'USD', actuals: undefined }).amount).toBe('90071992547409.91');
  });

  it('DD-MONEY-1 withholds Actual while its selected source is loading or failed', () => {
    const actuals = { currency: null, as_of: null, total: null, excludes_restricted_rows: false, categories: [] };
    expect(deriveActualPosition({ ledgerBasis: 'pmo', pmoSpent: undefined, pmoSpentPending: true, pmoSpentError: false, projectCurrency: 'IDR', actuals }).amount).toBeNull();
    expect(deriveActualPosition({ ledgerBasis: 'pmo', pmoSpent: undefined, pmoSpentPending: false, pmoSpentError: true, projectCurrency: 'IDR', actuals }).amount).toBeNull();
    expect(deriveActualPosition({ ledgerBasis: 'unavailable', pmoSpent: 125, pmoSpentPending: false, pmoSpentError: false, projectCurrency: 'IDR', actuals }))
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

describe('attributedSplit (#1271 AC-3)', () => {
  it('returns nothing when there is no attributed cost, so screens without rules stay unchanged', async () => {
    const { attributedSplit } = await import('./projectFinances');
    expect(attributedSplit({ tagged: '100.00', attributed: '0.00' })).toBeNull();
    expect(attributedSplit({ tagged: '100.00' })).toBeNull();
    expect(attributedSplit({ tagged: '100.00', attributed: null })).toBeNull();
    expect(attributedSplit({ attributed: 'abc' })).toBeNull();
  });

  it('returns the attributed amount and the tagged remainder when attributed is nonzero', async () => {
    const { attributedSplit } = await import('./projectFinances');
    expect(attributedSplit({ tagged: '100.00', attributed: '40.50' })).toEqual({ attributed: '40.50', tagged: '100.00' });
    expect(attributedSplit({ tagged: null, attributed: '40.50' })).toEqual({ attributed: '40.50', tagged: null });
  });
});

describe('parseContractExcess (FR-009/FR-010)', () => {
  const contributor = (id: string, contribution: string) => ({ invoice_id: id, invoice_number: `SI-${id}`, invoice_date: '2026-02-01', contribution });
  it('FR-009 is null while remaining is zero, positive or unknown', () => {
    for (const remaining of ['0.00', '400.00', null]) expect(parseContractExcess(null, remaining)).toBeNull();
  });
  it('FR-009 is known when the contributors reconcile exactly to the contract billing', () => {
    const raw = { amount: '100.00', contract_billing: '1100.00', contributors: [contributor('a', '700.00'), contributor('b', '400.00')] };
    expect(parseContractExcess(raw, '-100.00')).toEqual({ state: 'known', amount: '100.00', contractBilling: '1100.00',
      contributors: raw.contributors });
  });
  it('FR-009 derives the excess from remaining and says the detail is incomplete when contributors do not reconcile', () => {
    const raw = { amount: '100.00', contract_billing: '1100.00', contributors: [contributor('a', '700.00')] };
    expect(parseContractExcess(raw, '-100.00')).toEqual({ state: 'incomplete', amount: '100.00' });
  });
  it('FR-009 never shows a bare negative: a missing or malformed object still yields the derived excess', () => {
    expect(parseContractExcess(undefined, '-100.00')).toEqual({ state: 'incomplete', amount: '100.00' });
    expect(parseContractExcess({ amount: 'x' }, '-100.00')).toEqual({ state: 'incomplete', amount: '100.00' });
  });
  it('FR-009 refuses an excess whose amount disagrees with remaining', () => {
    const raw = { amount: '50.00', contract_billing: '1050.00', contributors: [contributor('a', '1050.00')] };
    expect(parseContractExcess(raw, '-100.00')).toEqual({ state: 'incomplete', amount: '100.00' });
  });
});

describe('equipment charge fields (#1519 S5; 0473 adds them to get_project_finances)', () => {
  const base = {
    project_id: '02900000-0000-0000-0000-000000000001',
    contract_invoiced: '1000.00',
    remaining_to_invoice: '420.00',
    invoices: [],
    budget: null,
    actuals: {
      currency: 'IDR', as_of: '2026-09-30T00:00:00Z', total: '580.00', tagged_total: '0.00', attributed_total: '580.00',
      excludes_restricted_rows: false,
      categories: [{ category: 'Equipment', mapped: true, amount: '580.00' }],
    },
  };
  /** Compiles ONLY with the S5.5 type additions, and reads them off a payload the guard has accepted. */
  const readCharge = (value: unknown): { total: string | null | undefined; perCategory: string | null | undefined } => {
    if (!isProjectFinances(value)) throw new Error('not project finances');
    return { total: value.actuals.equipment_charge_total, perCategory: value.actuals.categories[0]?.equipment_charge_amount };
  };

  it('AC-EQU-012 reads equipment_charge_total when present and tolerates its absence', () => {
    const withCharge = {
      ...base,
      actuals: {
        ...base.actuals,
        equipment_charge_total: '580.00',
        categories: [{ category: 'Equipment', mapped: true, amount: '580.00', equipment_charge_amount: '580.00' }],
      },
    };
    expect(isProjectFinances(withCharge)).toBe(true);
    expect(readCharge(withCharge)).toEqual({ total: '580.00', perCategory: '580.00' });
    // a payload from before 0473: both fields absent, still a valid reading, and the split reads as "none stated"
    expect(isProjectFinances(base)).toBe(true);
    expect(readCharge(base)).toEqual({ total: undefined, perCategory: undefined });
  });

  it('AC-EQU-012 a stated unknown charge (null) is preserved, never read as zero', () => {
    const withNull = {
      ...base,
      actuals: { ...base.actuals, equipment_charge_total: null, categories: [{ category: 'Equipment', mapped: true, amount: null, equipment_charge_amount: null }] },
    };
    expect(isProjectFinances(withNull)).toBe(true);
    expect(readCharge(withNull)).toEqual({ total: null, perCategory: null });
  });
});
