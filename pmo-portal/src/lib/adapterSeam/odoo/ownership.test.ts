import { describe, expect, it } from 'vitest';
import { ODOO_TIER } from './connectAdapter.ts';
import { erpnextOwnsExternalItemCatalog, odooOwnsExternalItemCatalog, odooOwnsRevenueTier } from './ownership.ts';

describe('Odoo revenue ownership seam', () => {
  it('identifies only the tier that owns Odoo revenue', () => {
    expect(odooOwnsRevenueTier(ODOO_TIER)).toBe(true);
    expect(odooOwnsRevenueTier('erpnext')).toBe(false);
    expect(odooOwnsRevenueTier(undefined)).toBe(false);
  });

  it('selects the external item-catalogue adapter and rejects unknown tier names', () => {
    expect(odooOwnsExternalItemCatalog(ODOO_TIER)).toBe(true);
    expect(erpnextOwnsExternalItemCatalog('erpnext')).toBe(true);
    expect(erpnextOwnsExternalItemCatalog(ODOO_TIER)).toBe(false);
    expect(erpnextOwnsExternalItemCatalog('unknown')).toBe(false);
    expect(odooOwnsExternalItemCatalog(undefined)).toBe(false);
  });
});
