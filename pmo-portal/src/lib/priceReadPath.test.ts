import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { maskSelection, priceFn, priceSource, setHidePricesActive } from './priceReadPath';

beforeEach(() => setHidePricesActive(false));

afterEach(() => setHidePricesActive(false));

describe('AC-001 (#2699) setting off: the read path is unchanged', () => {
  it('reads the table and keeps the select string as written', () => {
    const sel = '*, project:projects(name), purchase_orders(amount), items:procurement_items(*)';
    expect(priceSource('procurements')).toBe('procurements');
    expect(maskSelection(sel)).toBe(sel);
  });
});

describe('AC-004 (#2699) derived-amount functions', () => {
  it('calls the originals while the setting is off and the masked twins while it is on', () => {
    expect(priceFn('project_committed_spend')).toBe('project_committed_spend');
    expect(priceFn('procurement_open_commitments')).toBe('procurement_open_commitments');
    expect(maskSelection('*, open_commitment:procurement_open_commitment')).toBe('*, open_commitment:procurement_open_commitment');
    setHidePricesActive(true);
    expect(priceFn('project_committed_spend')).toBe('project_committed_spend_masked');
    expect(priceFn('procurement_open_commitments')).toBe('procurement_open_commitments_masked');
    expect(maskSelection('*, open_commitment:procurement_open_commitment')).toBe('*, open_commitment:procurement_open_commitment_masked');
  });
});

describe('AC-003 (#2699) setting on: the request screens read the masked views', () => {
  it('reads the view and rewrites only the price-bearing embeds', () => {
    setHidePricesActive(true);
    expect(priceSource('procurements')).toBe('procurements_masked');
    expect(maskSelection('*, project:projects(name), purchase_orders(amount), items:procurement_items(*), payments(amount)'))
      .toBe('*, project:projects(name), purchase_orders:purchase_orders_masked(amount), items:procurement_items_masked(*), payments:payments_masked(amount)');
    expect(maskSelection('invoices:procurement_invoices(*, voider:profiles!x(full_name))')).toBe('invoices:procurement_invoices_masked(*, voider:profiles!x(full_name))');
  });

  it('preserves PostgREST foreign-key and join hints when rewriting an embed', () => {
    setHidePricesActive(true);
    expect(maskSelection('purchase_orders!inner(id, procurements!purchase_orders_procurement_id_fkey!inner(title))'))
      .toBe('purchase_orders:purchase_orders_masked!inner(id, procurements:procurements_masked!purchase_orders_procurement_id_fkey!inner(title))');
  });
});

describe('#2788 planned equipment rates follow the read path', () => {
  it('rewrites the plan-line embed to its masked view only while the setting is on', () => {
    const sel = 'id, status, equipment_plan_lines(id, rate, vendor_id)';
    expect(maskSelection(sel)).toBe(sel);
    setHidePricesActive(true);
    expect(maskSelection(sel)).toBe('id, status, equipment_plan_lines:equipment_plan_lines_masked(id, rate, vendor_id)');
  });
});
