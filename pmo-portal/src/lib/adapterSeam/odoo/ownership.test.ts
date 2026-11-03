import { describe, expect, it } from 'vitest';
import { ODOO_TIER } from './connectAdapter.ts';
import { odooOwnsRevenueTier } from './ownership.ts';

describe('Odoo revenue ownership seam', () => {
  it('identifies only the tier that owns Odoo revenue', () => {
    expect(odooOwnsRevenueTier(ODOO_TIER)).toBe(true);
    expect(odooOwnsRevenueTier('erpnext')).toBe(false);
    expect(odooOwnsRevenueTier(undefined)).toBe(false);
  });
});
