import { afterEach, describe, expect, it } from 'vitest';
import { maskSelection, priceEmbed, priceSource, setHidePricesActive } from './priceReadPath';

afterEach(() => setHidePricesActive(false));

describe('AC-001 (#2699) setting off: the read path is unchanged', () => {
  it('reads the table and keeps the select string as written', () => {
    const sel = '*, project:projects(name), purchase_orders(amount), items:procurement_items(*)';
    expect(priceSource('procurements')).toBe('procurements');
    expect(maskSelection(sel)).toBe(sel);
    expect(priceEmbed('payments', 'amount')).toBe('payments(amount)');
  });
});

describe('AC-003 (#2699) setting on: the request screens read the masked views', () => {
  it('reads the view and rewrites only the price-bearing embeds', () => {
    setHidePricesActive(true);
    expect(priceSource('procurements')).toBe('procurements_masked');
    expect(maskSelection('*, project:projects(name), purchase_orders(amount), items:procurement_items(*), payments(amount)'))
      .toBe('*, project:projects(name), purchase_orders:purchase_orders_masked(amount), items:procurement_items_masked(*), payments:payments_masked(amount)');
    expect(maskSelection('invoices:procurement_invoices(*, voider:profiles!x(full_name))')).toBe('invoices:procurement_invoices_masked(*, voider:profiles!x(full_name))');
    expect(priceEmbed('payments', 'amount')).toBe('payments:payments_masked(amount)');
  });
});
