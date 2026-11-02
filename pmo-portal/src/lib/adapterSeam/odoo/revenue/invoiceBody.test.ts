import { describe, expect, it } from 'vitest';
import { buildInvoiceBody, resolveClientReference, type InvoiceMaps, type PmoInvoice } from './invoiceBody.ts';

const maps: InvoiceMaps = {
  companyCurrency: 'IDR',
  partners: { 'cust-1': 41 },
  items: { 'item-km': { productId: 71, incomeAccountId: 149 }, 'item-dp': { productId: 72, incomeAccountId: 210 }, 'item-bare': { productId: 73, incomeAccountId: null } },
  units: { km: 11, hour: 12 },
  costAccountId: 4,
  taxIds: [5],
  downPayment: { itemId: 'item-dp', advanceAccountId: 210 },
};
const invoice: PmoInvoice = {
  id: 'inv-1', customerId: 'cust-1', invoiceDate: '2026-11-03', currency: 'IDR', referenceNumber: ' PO-77 ', workOrderPoNumber: 'WO-9', projectContractRef: 'CT-1',
  receivedDate: '2026-11-04', dueDate: '2026-12-01',
  lines: [{ itemId: 'item-km', description: 'BoQ 1', quantity: 10, unitPrice: 50000, unit: 'km' }],
};
const lineOf = (body: unknown, i = 0) => ((body as { invoice_line_ids: Array<[number, number, Record<string, unknown>]> }).invoice_line_ids[i][2]);
const ready = (inv: PmoInvoice, m: InvoiceMaps = maps) => {
  const r = buildInvoiceBody(inv, m);
  if (r.outcome !== 'ready') throw new Error(`refused: ${JSON.stringify(r)}`);
  return r.body;
};

describe('AC-OCI-023 the builder transports the record, never recomputes it', () => {
  it('maps partner, line, unit, product, explicit taxes and the cost account onto the create payload', () => {
    expect(ready(invoice)).toEqual({
      move_type: 'out_invoice', partner_id: 41, invoice_date: '2026-11-03', ref: 'PO-77',
      invoice_line_ids: [[0, 0, { product_id: 71, name: 'BoQ 1', quantity: 10, price_unit: 50000, product_uom_id: 11, tax_ids: [[6, 0, [5]]], analytic_distribution: { '4': 100 } }]],
    });
  });

  it('lines equal the record exactly: odd decimals, fractions and a negative recovery price pass through untouched', () => {
    const lines = [
      { itemId: 'item-km', description: 'a', quantity: 3, unitPrice: 333.33, unit: 'km' },
      { itemId: 'item-km', description: 'b', quantity: 0.125, unitPrice: 1000.5, unit: 'hour' },
      { itemId: 'item-dp', description: 'recovery', quantity: 1, unitPrice: -40000, unit: 'km', kind: 'recovery' as const },
      { itemId: 'item-km', description: 'c', quantity: 10, unitPrice: 50000, unit: 'km' },
    ];
    const body = ready({ ...invoice, lines });
    lines.forEach((l, i) => {
      expect(lineOf(body, i).quantity).toBe(l.quantity);
      expect(lineOf(body, i).price_unit).toBe(l.unitPrice);
    });
    expect((body as { invoice_line_ids: unknown[] }).invoice_line_ids).toHaveLength(lines.length);
  });

  it('AC-OCI-014 carries no due date and no received date', () => {
    const json = JSON.stringify(ready(invoice));
    expect(json).not.toMatch(/due|received|2026-12-01|2026-11-04/i);
  });

  it('every line, including a negative recovery line, carries the cost-account distribution; none when the project gate is off', () => {
    const lines = [invoice.lines[0], { itemId: 'item-dp', description: 'recovery', quantity: 1, unitPrice: -40000, unit: 'km', kind: 'recovery' as const }];
    const body = ready({ ...invoice, lines });
    for (const i of [0, 1]) expect(lineOf(body, i).analytic_distribution).toEqual({ '4': 100 });
    expect(lineOf(ready(invoice, { ...maps, costAccountId: null }))).not.toHaveProperty('analytic_distribution');
  });

  it('VAT off sends an explicit empty tax set, never an omitted one', () => {
    expect(lineOf(ready(invoice, { ...maps, taxIds: [] })).tax_ids).toEqual([[6, 0, []]]);
  });

  it('a line carrying its own income account sends it; otherwise the item account stands', () => {
    const body = ready({ ...invoice, lines: [{ ...invoice.lines[0], incomeAccountId: 300 }] });
    expect(lineOf(body).account_id).toBe(300);
    expect(lineOf(ready(invoice))).not.toHaveProperty('account_id');
  });
});

describe('AC-OCI-023 customer reference resolution (invoice, else work order PO, else project contract reference)', () => {
  it.each([
    [{ invoice: ' PO-77 ', workOrderPo: 'WO-9', projectContractRef: 'CT-1' }, 'PO-77'],
    [{ invoice: '  ', workOrderPo: 'WO-9', projectContractRef: 'CT-1' }, 'WO-9'],
    [{ invoice: null, workOrderPo: null, projectContractRef: ' CT-1 ' }, 'CT-1'],
    [{ invoice: '', workOrderPo: undefined, projectContractRef: undefined }, null],
  ])('%o → %s', (input, expected) => expect(resolveClientReference(input)).toBe(expected));

  it('a work-order claim sends the work order PO as the reference; with none, no reference key is sent', () => {
    expect((ready({ ...invoice, referenceNumber: null }) as { ref: string }).ref).toBe('WO-9');
    expect(ready({ ...invoice, referenceNumber: null, workOrderPoNumber: null, projectContractRef: null })).not.toHaveProperty('ref');
  });
});

describe('AC-OCI-012 refusals before any write name the unmapped thing', () => {
  it.each([
    ['client', { ...invoice, customerId: 'cust-x' }, maps, 'cust-x'],
    ['item', { ...invoice, lines: [{ ...invoice.lines[0], itemId: 'item-x' }] }, maps, 'item-x'],
    ['unit', { ...invoice, lines: [{ ...invoice.lines[0], unit: 'furlong' }] }, maps, 'furlong'],
    ['income-account', { ...invoice, lines: [{ ...invoice.lines[0], itemId: 'item-bare' }] }, maps, 'item-bare'],
    ['currency', { ...invoice, currency: 'USD' }, maps, 'USD'],
  ] as const)('%s', (thing, inv, m, name) => {
    expect(buildInvoiceBody(inv as PmoInvoice, m)).toEqual({ outcome: 'refused', code: 'config-rejected', thing, name });
  });

  it('refuses an invoice with no lines and a net-negative invoice (Odoo would refuse the post and strand a draft)', () => {
    expect(buildInvoiceBody({ ...invoice, lines: [] }, maps)).toMatchObject({ outcome: 'refused', thing: 'lines' });
    const negative = { ...invoice, lines: [invoice.lines[0], { itemId: 'item-dp', description: 'r', quantity: 1, unitPrice: -600000, unit: 'km', kind: 'recovery' as const }] };
    expect(buildInvoiceBody(negative, maps)).toMatchObject({ outcome: 'refused', thing: 'net-negative' });
  });

  it('a recovery that nets the invoice to exactly zero is allowed (Odoo posts a zero total and reads it paid)', () => {
    const zero = { ...invoice, lines: [invoice.lines[0], { itemId: 'item-dp', description: 'r', quantity: 1, unitPrice: -500000, unit: 'km', kind: 'recovery' as const }] };
    expect(buildInvoiceBody(zero, maps).outcome).toBe('ready');
  });
});

describe('AC-OCI-022 the down-payment item must sit on the configured advance account', () => {
  const dp = { ...invoice, lines: [{ itemId: 'item-dp', description: 'advance', quantity: 1, unitPrice: 200000, unit: 'km', kind: 'down-payment' as const }] };
  it('accepts when the item income account is the advance account and sends no account override', () => {
    expect(lineOf(ready(dp)).account_id).toBeUndefined();
    expect(lineOf(ready(dp)).product_id).toBe(72);
  });
  it.each([
    ['down-payment line on another account', dp, { ...maps, items: { ...maps.items, 'item-dp': { productId: 72, incomeAccountId: 149 } } }],
    ['recovery line on another account', { ...invoice, lines: [invoice.lines[0], { ...dp.lines[0], kind: 'recovery' as const, unitPrice: -1 }] }, { ...maps, items: { ...maps.items, 'item-dp': { productId: 72, incomeAccountId: 149 } } }],
    ['no advance account configured', dp, { ...maps, downPayment: undefined }],
    ['the item has no account in the directory', dp, { ...maps, items: { ...maps.items, 'item-dp': { productId: 72, incomeAccountId: null } } }],
    ['the line names another item', { ...dp, lines: [{ ...dp.lines[0], itemId: 'item-km' }] }, maps],
    ['the line carries its own income account', { ...dp, lines: [{ ...dp.lines[0], incomeAccountId: 149 }] }, maps],
  ] as const)('refuses config-rejected naming the item: %s', (_label, inv, m) => {
    expect(buildInvoiceBody(inv as PmoInvoice, m as InvoiceMaps)).toMatchObject({ outcome: 'refused', code: 'config-rejected', thing: 'down-payment-account' });
  });
});

describe('purity', () => {
  it('does not mutate its inputs', () => {
    const before = JSON.stringify([invoice, maps]);
    buildInvoiceBody(invoice, maps);
    expect(JSON.stringify([invoice, maps])).toBe(before);
  });
});
