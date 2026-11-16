import { expect, it } from 'vitest';
import { anchorValue, externalIdentifier, keyFromExternalIdentifier, ODOO_ANCHORS, odooExternalRef, odooRevenueDocumentRef, parseOdooExternalRef } from './anchors.ts';
it('uses validated keys and separates identifiers from payment memo', () => {
  const key = 'po:123e4567-e89b-12d3-a456-426614174000';
  expect(anchorValue(key)).toBe(`pmo:${key}`);
  expect(externalIdentifier(key)).toEqual({ module: 'pmo', name: 'po_123e4567_e89b_12d3_a456_426614174000' });
  expect(() => anchorValue('po:bad')).toThrow();
  expect(ODOO_ANCHORS.order.mutable).toBe(false);
  expect(ODOO_ANCHORS.payment.mutable).toBe(true);
});

it('an equipment key is a valid anchor too: `equipment:<uuid>` names one register record (#1511 F4)', () => {
  const key = 'equipment:123e4567-e89b-12d3-a456-426614174000';
  expect(anchorValue(key)).toBe(`pmo:${key}`);
  expect(externalIdentifier(key)).toEqual({ module: 'pmo', name: 'equipment_123e4567_e89b_12d3_a456_426614174000' });
  for (const bad of ['equipment:bad', 'equipment', 'equipment:', 'maintenance:123e4567-e89b-12d3-a456-426614174000']) {
    expect(() => anchorValue(bad), bad).toThrow();
  }
});

it('a stock key is a valid anchor: `stock:<uuid>` names one stock movement (#1508)', () => {
  const key = 'stock:123e4567-e89b-12d3-a456-426614174000';
  expect(anchorValue(key)).toBe(`pmo:${key}`);
  expect(externalIdentifier(key)).toEqual({ module: 'pmo', name: 'stock_123e4567_e89b_12d3_a456_426614174000' });
  expect(keyFromExternalIdentifier('stock_123e4567_e89b_12d3_a456_426614174000')).toBe(key);
  for (const bad of ['stock:bad', 'stock', 'stock:']) {
    expect(() => anchorValue(bad), bad).toThrow();
  }
});

it('an external ref carries its Odoo model, so ids of different models never share one', () => {
  expect(odooExternalRef('stock.picking', 1)).toBe('stock.picking:1');
  expect(odooExternalRef('purchase.order', '1')).toBe('purchase.order:1');
  expect(odooExternalRef('stock.picking', 1)).not.toBe(odooExternalRef('purchase.order', 1));
  expect(parseOdooExternalRef('stock.picking', 'stock.picking:42')).toBe(42);
  for (const bad of ['42', 'purchase.order:42', 'stock.picking:', 'stock.picking:0', 'stock.picking:4x', 'stock.picking:042', null, 42]) expect(parseOdooExternalRef('stock.picking', bad)).toBeNull();
  expect(() => odooExternalRef('stock.picking', 0)).toThrow();
  expect(() => odooExternalRef('not a model', 1)).toThrow();
});

it('AC-OPP-072 an identifier name turns back into the PMO key it was made from (orders and bills only)', () => {
  for (const key of ['po:123e4567-e89b-12d3-a456-426614174000', 'bill:123e4567-e89b-12d3-a456-426614174001']) {
    expect(keyFromExternalIdentifier(externalIdentifier(key).name)).toBe(key);
  }
  for (const bad of ['po_123e4567_e89b_12d3_a456', 'pay_123e4567_e89b_12d3_a456_426614174000', 'PO_123E4567_E89B_12D3_A456_426614174000x', 'po-123e4567-e89b-12d3-a456-426614174000', '', 'x']) {
    expect(keyFromExternalIdentifier(bad), bad).toBeNull();
  }
});

it('maps a held customer document number to the Odoo model that holds it', () => {
  expect(odooRevenueDocumentRef('sales-invoice', '42')).toBe('account.move:42');
  expect(odooRevenueDocumentRef('incoming-payment', 42)).toBe('account.payment:42');
  expect(() => odooRevenueDocumentRef('sales-invoice', 'abc')).toThrow();
});

it('#895 a manual-journal key and a journal-reversal key are valid anchors (one PMO journal, one Odoo move)', () => {
  const id = '123e4567-e89b-12d3-a456-426614174000';
  expect(externalIdentifier(`journal:${id}`)).toEqual({ module: 'pmo', name: `journal_${id.replace(/-/g, '_')}` });
  expect(externalIdentifier(`journal-rev:${id}`)).toEqual({ module: 'pmo', name: `journal_rev_${id.replace(/-/g, '_')}` });
  expect(anchorValue(`journal:${id}`)).toBe(`pmo:journal:${id}`);
  for (const bad of [`journal:${id}:x`, `journal:${id}:1`, 'journal:bad', `journal-rev:${id}:1`, `journal:${id.slice(0, 35)}`]) {
    expect(() => externalIdentifier(bad), bad).toThrow();
  }
});
