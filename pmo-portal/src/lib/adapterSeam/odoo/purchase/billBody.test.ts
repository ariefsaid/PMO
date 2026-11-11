import { describe, expect, it } from 'vitest';
import { buildBillBody, chooseTaxIds, expectedBillTotal, selectBillTaxes, type BillCtx, type BillInput, type BillTax } from './billBody.ts';

const VAT: BillTax = { id: 11, name: 'VAT 11%', rate: 11, active: true, companyId: 1, scope: 'purchase', liabilityAccount: false };
const PPH: BillTax = { id: 12, name: 'Withholding 2%', rate: -2, active: true, companyId: 1, scope: 'purchase', liabilityAccount: true };
const INPUT: BillInput = {
  vendor: 'Vendor:9', reference: 'INV-77', invoiceDate: '2026-12-05', projectIds: ['p-1'],
  lines: [{ name: 'Cable tray', quantity: 4, rate: 10 }, { name: 'Bolt', quantity: 2, rate: 5, purchaseLineId: 301 }],
};
const CTX: BillCtx = { companyId: 1, currencyId: 12, itemMap: { 'Cable tray': '55', Bolt: '56' }, unitMap: {}, costAccountId: '101', taxes: [VAT, PPH] };
const reason = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as Error).message; } return 'no refusal'; };

describe('a unit text with stray spaces looks up the trimmed key the map is saved under', () => {
  it('bill lines', () => {
    const body = buildBillBody({ ...INPUT, lines: [{ name: 'Cable tray', quantity: 4, rate: 10, unit: ' m ' }] }, { ...CTX, unitMap: { m: '11' } }) as { invoice_line_ids: Array<[number, number, Record<string, unknown>]> };
    expect(body.invoice_line_ids[0][2].product_uom_id).toBe(11);
  });
});

describe('FR-OPP-040 the bill body', () => {
  it('sends the vendor invoice number as the reference, the vendor date, explicit tax ids, the cost account and the order-line link', () => {
    const body = buildBillBody(INPUT, CTX) as Record<string, unknown>;
    expect(body).toMatchObject({ move_type: 'in_invoice', partner_id: 9, company_id: 1, currency_id: 12, ref: 'INV-77', invoice_date: '2026-12-05' });
    const lines = (body.invoice_line_ids as Array<[number, number, Record<string, unknown>]>).map(([, , v]) => v);
    expect(lines).toEqual([
      { product_id: 55, name: 'Cable tray', quantity: 4, price_unit: 10, tax_ids: [[6, 0, [11, 12]]], analytic_distribution: { '101': 100 } },
      { product_id: 56, name: 'Bolt', quantity: 2, price_unit: 5, tax_ids: [[6, 0, [11, 12]]], analytic_distribution: { '101': 100 }, purchase_line_id: 301 },
    ]);
  });

  it('the vendor reference is the vendor invoice number alone: no PMO anchor is written into any business field', () => {
    const body = JSON.stringify(buildBillBody(INPUT, CTX));
    expect(body).not.toContain('pmo:');
    expect(body).not.toContain('bill:');
  });

  it('AC-OPP-046 tax ids are ALWAYS explicit, an empty choice included: Odoo\'s per-product defaults are never relied on', () => {
    const body = buildBillBody(INPUT, { ...CTX, taxes: [] }) as { invoice_line_ids: Array<[number, number, Record<string, unknown>]> };
    for (const [, , line] of body.invoice_line_ids) expect(line.tax_ids).toEqual([[6, 0, []]]);
  });

  it('a case with no project sends no distribution; a day-less invoice takes the given fallback date', () => {
    const body = buildBillBody({ ...INPUT, projectIds: [], invoiceDate: null }, { ...CTX, costAccountId: null }, '2026-12-09') as { invoice_date: string; invoice_line_ids: Array<[number, number, Record<string, unknown>]> };
    expect(body.invoice_date).toBe('2026-12-09');
    expect(body.invoice_line_ids[0][2]).not.toHaveProperty('analytic_distribution');
  });

  it('a due date, a mapped unit and a description travel when given', () => {
    const body = buildBillBody({ ...INPUT, dueDate: '2026-12-31', lines: [{ name: 'Cable tray', quantity: 1, rate: 10, unit: 'm', description: 'Tray 3 m' }] }, { ...CTX, unitMap: { m: '7' } }) as Record<string, unknown>;
    expect(body.invoice_date_due).toBe('2026-12-31');
    expect((body.invoice_line_ids as Array<[number, number, Record<string, unknown>]>)[0][2]).toMatchObject({ name: 'Tray 3 m', product_uom_id: 7 });
  });

  it.each([
    ['an unmapped item', { ...INPUT, lines: [{ name: 'Gasket', quantity: 1, rate: 1 }] }, CTX, 'item-unmapped: Gasket'],
    ['an unmapped vendor', { ...INPUT, vendor: null }, CTX, 'vendor-unmapped'],
    ['two projects', { ...INPUT, projectIds: ['p-1', 'p-2'] }, CTX, 'multiple-projects'],
    ['an unresolved cost account', INPUT, { ...CTX, costAccountId: null }, 'project-unlinked'],
    ['no lines', { ...INPUT, lines: [] }, CTX, 'no-lines'],
    ['a zero quantity', { ...INPUT, lines: [{ name: 'Bolt', quantity: 0, rate: 5 }] }, CTX, 'line-invalid: Bolt'],
  ] as const)('refuses %s before it builds anything', (_n, input, ctx, message) => {
    expect(reason(() => buildBillBody(input, ctx))).toBe(message);
  });
});

describe('OQ-OPP-4 choosing and validating the tax set', () => {
  it('a choice wins; no choice takes the company default; an empty choice is an explicit "no tax"', () => {
    expect(chooseTaxIds([12], [11])).toEqual([12]);
    expect(chooseTaxIds(undefined, [11])).toEqual([11]);
    expect(chooseTaxIds(null, [11])).toEqual([11]);
    expect(chooseTaxIds([], [11])).toEqual([]);
  });

  const directory = [VAT, PPH, { ...VAT, id: 13, name: 'Old VAT', active: false }];
  it('AC-OPP-042 well-formed sets pass: VAT only, withholding only, both', () => {
    expect(selectBillTaxes(directory, [11], 1).map((t) => t.id)).toEqual([11]);
    expect(selectBillTaxes(directory, [12], 1).map((t) => t.id)).toEqual([12]);
    expect(selectBillTaxes(directory, [11, 12], 1).map((t) => t.id)).toEqual([11, 12]);
  });
  it('AC-OPP-042 a tax missing from the directory, inactive, or another company\'s refuses naming it', () => {
    expect(reason(() => selectBillTaxes(directory, [99], 1))).toBe('config-rejected: tax-unknown 99');
    expect(reason(() => selectBillTaxes(directory, [13], 1))).toBe('config-rejected: Old VAT');
    expect(reason(() => selectBillTaxes(directory, [11], 2))).toBe('config-rejected: VAT 11%');
  });
  it('a withholding tax with no liability account refuses', () => {
    expect(reason(() => selectBillTaxes([{ ...PPH, liabilityAccount: false }], [12], 1))).toBe('config-rejected: Withholding 2%');
  });
});

describe('the figure PMO sent (FR-OPP-044): what Odoo should total, from the explicit taxes', () => {
  it('AC-OPP-040 100 + VAT 11% + withholding 2% totals 109.00 (Odoo\'s net-of-withholding total)', () => {
    expect(expectedBillTotal({ ...INPUT, lines: [{ name: 'Cable tray', quantity: 1, rate: 100 }] }, [VAT, PPH])).toBe('109.00');
  });
  it('rounds each line\'s tax to the cent, as Odoo does per line, half away from zero', () => {
    // 3 x 0.05 = 0.15; 11% = 0.0165 -> 0.02; withholding 2% = -0.003 -> 0.00
    expect(expectedBillTotal({ ...INPUT, lines: [{ name: 'Cable tray', quantity: 3, rate: 0.05 }] }, [VAT, PPH])).toBe('0.17');
    // 1 x 12.5 withheld 2% = -0.25 exactly; 1 x 0.25 at -2% = -0.005 -> -0.01 (away from zero)
    expect(expectedBillTotal({ ...INPUT, lines: [{ name: 'Cable tray', quantity: 1, rate: 0.25 }] }, [PPH])).toBe('0.24');
  });
  it('no taxes: the plain subtotal', () => {
    expect(expectedBillTotal(INPUT, [])).toBe('50.00');
  });
});
