import { describe, expect, it } from 'vitest';
import { ODOO_TIER } from './connectAdapter.ts';
import { odooOwnsRevenueTier, odooOwnsTier } from './ownership.ts';

describe('Odoo tier ownership seam', () => {
  it('identifies only the tier that owns Odoo revenue', () => {
    expect(odooOwnsRevenueTier(ODOO_TIER)).toBe(true);
    expect(odooOwnsRevenueTier('erpnext')).toBe(false);
    expect(odooOwnsRevenueTier(undefined)).toBe(false);
  });

  it('keeps the generic Odoo tier check inside the tier seam for out-of-seam recovery code', () => {
    expect(odooOwnsTier(ODOO_TIER)).toBe(true);
    expect(odooOwnsTier('erpnext')).toBe(false);
    expect(odooOwnsTier(undefined)).toBe(false);
  });
});
