import { describe, expect, it } from 'vitest';
import { buildOrderBody, type OrderCtx, type OrderInput } from './orderBody.ts';

const CTX: OrderCtx = { companyId: 1, currencyId: 12, itemMap: { 'Cable tray': '55', Bolt: '56' }, unitMap: { m: '11' }, costAccountId: '101', taxIds: [7] };
const PO: OrderInput = {
  vendor: 'Vendor:9', caseNumber: 'PRC-001', vendorReference: 'PO-77', expectedDate: '2026-12-01', projectIds: ['p-1'],
  lines: [{ name: 'Cable tray', quantity: 4, rate: '10.50', unit: 'm' }, { name: 'Bolt', quantity: '2.00', rate: 3, description: 'M8 bolt' }],
};
const refusal = (po: OrderInput, ctx: OrderCtx = CTX) => { try { buildOrderBody(po, ctx); } catch (e) { return e; } return null; };

describe('AC-OPP-010 the order body', () => {
  it('carries vendor, company, references, and one line per PMO item with product, qty, price, unit, taxes, distribution', () => {
    expect(buildOrderBody(PO, CTX)).toEqual({
      partner_id: 9, company_id: 1, currency_id: 12, partner_ref: 'PO-77', origin: 'PRC-001',
      order_line: [
        [0, 0, { product_id: 55, name: 'Cable tray', product_qty: 4, price_unit: 10.5, date_planned: '2026-12-01 00:00:00', uom_id: 11, tax_ids: [[6, 0, [7]]], analytic_distribution: { '101': 100 } }],
        [0, 0, { product_id: 56, name: 'M8 bolt', product_qty: 2, price_unit: 3, date_planned: '2026-12-01 00:00:00', tax_ids: [[6, 0, [7]]], analytic_distribution: { '101': 100 } }],
      ],
    });
  });

  it('I4 the order currency is sent explicitly (the company currency PMO checked), never left to the vendor\'s Odoo default', () => {
    expect(buildOrderBody(PO, { ...CTX, currencyId: 31 })).toMatchObject({ currency_id: 31 });
  });

  it('never carries the idempotency key in a business field (the anchor is an external identifier)', () => {
    expect(JSON.stringify(buildOrderBody(PO, CTX))).not.toMatch(/pmo:|po:/);
  });

  it('sends explicit empty taxes (never Odoo defaults) and no distribution for a case with no project', () => {
    const body = buildOrderBody({ ...PO, projectIds: [] }, { ...CTX, taxIds: [], costAccountId: null }) as { order_line: Array<[number, number, Record<string, unknown>]> };
    expect(body.order_line[0][2].tax_ids).toEqual([[6, 0, []]]);
    expect(body.order_line[0][2]).not.toHaveProperty('analytic_distribution');
  });
});

describe('a unit text with stray spaces looks up the trimmed key the map is saved under', () => {
  it('order lines', () => {
    const body = buildOrderBody({ ...PO, lines: [{ name: 'Cable tray', quantity: 4, rate: '10.50', unit: ' m ' }] }, CTX) as { order_line: Array<[number, number, Record<string, unknown>]> };
    expect(body.order_line[0][2].uom_id).toBe(11);
  });
});

describe('AC-OPP-013 an unmapped thing refuses before any write, naming it', () => {
  it.each([
    ['item', { ...PO, lines: [{ name: 'Gasket', quantity: 1, rate: 1 }] }, 'item-unmapped: Gasket'],
    ['unit', { ...PO, lines: [{ name: 'Bolt', quantity: 1, rate: 1, unit: 'box' }] }, 'unit-unmapped: box'],
    ['vendor', { ...PO, vendor: null }, 'vendor-unmapped'],
    ['vendor that is not a vendor id', { ...PO, vendor: 'Client:9' }, 'vendor-unmapped'],
  ] as const)('%s', (_n, po, message) => {
    expect(refusal(po as OrderInput)).toMatchObject({ code: 'commit-rejected', message });
  });

  it('an item mapped to something that is not an Odoo id is unmapped', () => {
    expect(refusal(PO, { ...CTX, itemMap: { ...CTX.itemMap, Bolt: 'x1' } })).toMatchObject({ message: 'item-unmapped: Bolt' });
  });

  it('a line with no quantity or a negative price is refused', () => {
    expect(refusal({ ...PO, lines: [{ name: 'Bolt', quantity: 0, rate: 1 }] })).toMatchObject({ code: 'commit-rejected', message: 'line-invalid: Bolt' });
    expect(refusal({ ...PO, lines: [{ name: 'Bolt', quantity: 1, rate: -1 }] })).toMatchObject({ message: 'line-invalid: Bolt' });
  });

  it('an order with no lines is refused', () => {
    expect(refusal({ ...PO, lines: [] })).toMatchObject({ message: 'no-lines' });
  });
});

describe('AC-OPP-014 / FR-OPP-021 one project, one resolved cost account', () => {
  it('a case naming two projects refuses', () => {
    expect(refusal({ ...PO, projectIds: ['p-1', 'p-2'] })).toMatchObject({ code: 'commit-rejected', message: 'multiple-projects' });
  });
  it('a project whose cost account did not resolve refuses (no guess)', () => {
    expect(refusal(PO, { ...CTX, costAccountId: null })).toMatchObject({ code: 'commit-rejected', message: 'project-unlinked' });
  });
});
