import { describe, expect, it, vi } from 'vitest';
import { readExternalItemCatalog } from './externalItemCatalog.ts';

describe('external item catalogue routing', () => {
  it('uses the provider registered for each owning tier', async () => {
    const erpnext = vi.fn(async () => 'erpnext items');
    const odoo = vi.fn(async () => 'odoo items');

    await expect(readExternalItemCatalog('odoo', { erpnext, odoo })).resolves.toBe('odoo items');
    await expect(readExternalItemCatalog('erpnext', { erpnext, odoo })).resolves.toBe('erpnext items');
    expect([erpnext, odoo].map((reader) => reader.mock.calls.length)).toEqual([1, 1]);
  });

  it('does not select a catalogue for an unknown or absent tier', async () => {
    const erpnext = vi.fn(async () => 'erpnext items');
    const odoo = vi.fn(async () => 'odoo items');
    await expect(readExternalItemCatalog('reference', { erpnext, odoo })).resolves.toBeNull();
    await expect(readExternalItemCatalog(null, { erpnext, odoo })).resolves.toBeNull();
    expect([erpnext, odoo].map((reader) => reader.mock.calls.length)).toEqual([0, 0]);
  });
});
