import { describe, expect, it } from 'vitest';
import { bindCall } from './client.ts';
import { createOdooAdapter } from './adapter.ts';
import { LIST_PAGE } from './connectAdapter.ts';
import { createFakeOdoo } from './fakeOdoo.ts';

const COMPANY_COLUMNS = ['id', 'name', 'type', 'erp_party_type', 'erp_tax_id', 'erp_modified'];
const setup = () => {
  const fake = createFakeOdoo({ key: 'k' });
  const adapter = createOdooAdapter(bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', fetchImpl: fake.fetch }), { companyId: 1, analyticPlanId: 7, unitMap: {} });
  return { fake, adapter };
};
const partner = (id: number, extra: Record<string, unknown> = {}) =>
  ({ id, name: `P${id}`, vat: false, ref: false, is_company: true, parent_id: false, active: true, supplier_rank: 1, customer_rank: 0, ...extra });

describe('odoo Adapter (companies)', () => {
  it('owns only companies', () => expect([...setup().adapter.capabilityMap]).toEqual(['companies']));

  it('create looks up the pmo anchor, then creates; canonical keys stay within the companies columns', async () => {
    const { fake, adapter } = setup();
    const r = await adapter.commit({ domain: 'companies', operation: 'create', record: { id: 'c-1', name: 'PT Satu', type: 'Vendor', erp_tax_id: '01' } });
    const [row] = fake.rows('res.partner');
    expect(row).toMatchObject({ name: 'PT Satu', vat: '01', ref: 'pmo:c-1', supplier_rank: 1 });
    expect(r.externalRecordId).toBe(`Vendor:${row.id}`);
    expect(r.canonical.id).toBe('c-1');
    expect(Object.keys(r.canonical).every((k) => COMPANY_COLUMNS.includes(k))).toBe(true);
    const again = await adapter.commit({ domain: 'companies', operation: 'create', record: { id: 'c-1', name: 'PT Satu', type: 'Vendor', erp_tax_id: '01' } });
    expect(again.externalRecordId).toBe(r.externalRecordId);
    expect(fake.rows('res.partner')).toHaveLength(1);
  });

  it('a Client company becomes a customer-ranked partner with a Client: id', async () => {
    const { fake, adapter } = setup();
    const r = await adapter.commit({ domain: 'companies', operation: 'create', record: { id: 'c-2', name: 'PT Dua', type: 'Client' } });
    expect(r.externalRecordId).toMatch(/^Client:/);
    expect(fake.rows('res.partner')[0]).toMatchObject({ customer_rank: 1, vat: false });
  });

  it('update writes name and vat to the partner named by the external id', async () => {
    const { fake, adapter } = setup();
    fake.seed('res.partner', [partner(5)]);
    const r = await adapter.commit({ domain: 'companies', operation: 'update', record: { id: 'c-5', name: 'PT Lima', type: 'Vendor', erp_tax_id: null, externalRecordId: 'Vendor:5' } });
    expect(fake.rows('res.partner')[0]).toMatchObject({ id: 5, name: 'PT Lima', vat: false });
    expect(r).toMatchObject({ externalRecordId: 'Vendor:5', canonical: { id: 'c-5', name: 'PT Lima' } });
  });

  it('refuses another domain, an update without an external id, and delete', async () => {
    const { adapter } = setup();
    await expect(adapter.commit({ domain: 'budget', operation: 'create', record: { id: 'x' } })).rejects.toMatchObject({ code: 'commit-rejected' });
    await expect(adapter.commit({ domain: 'companies', operation: 'update', record: { id: 'x', name: 'n', type: 'Vendor' } })).rejects.toMatchObject({ code: 'commit-rejected' });
    await expect(adapter.commit({ domain: 'companies', operation: 'delete', record: { id: 'x' } })).rejects.toMatchObject({ code: 'commit-rejected' });
    await expect(adapter.getByExternalId('budget', 'Vendor:1')).rejects.toMatchObject({ code: 'commit-rejected' });
    await expect(adapter.listChangesSinceWatermark('budget', null)).rejects.toMatchObject({ code: 'commit-rejected' });
  });

  it('getByExternalId returns the PMO-shaped partner, or null when absent', async () => {
    const { fake, adapter } = setup();
    fake.seed('res.partner', [partner(5, { vat: '05', customer_rank: 1, write_date: '2026-02-01 00:00:00' })]);
    expect(await adapter.getByExternalId('companies', 'Client:5')).toEqual({
      id: 'Client:5', name: 'P5', type: 'Client', erp_party_type: 'Client', erp_tax_id: '05', erp_modified: '2026-02-01 00:00:00',
    });
    expect(await adapter.getByExternalId('companies', 'Vendor:99')).toBeNull();
    await expect(adapter.getByExternalId('companies', 'nonsense')).rejects.toMatchObject({ code: 'commit-rejected' });
  });

  it('listChangesSinceWatermark pages partners by (write_date, id) with one company per role and no contacts', async () => {
    const { fake, adapter } = setup();
    fake.seed('res.partner', [
      partner(1, { write_date: '2026-01-01 00:00:01', customer_rank: 1 }),
      partner(2, { write_date: '2026-01-01 00:00:01', supplier_rank: 0 }), // no role: not a company yet
      { id: 3, name: 'contact', is_company: false, parent_id: [1, 'P1'], write_date: '2026-01-01 00:00:02' },
      partner(4, { write_date: '2026-01-01 00:00:00' }),
    ]);
    const all = await adapter.listChangesSinceWatermark('companies', null);
    expect(all.changes.map((c) => c.id)).toEqual(['Vendor:4', 'Vendor:1', 'Client:1']);
    expect(all.nextCursor).toBeNull();
    const after = await adapter.listChangesSinceWatermark('companies', JSON.stringify({ w: '2026-01-01 00:00:01', id: 1 }));
    expect(after.changes).toEqual([]);
  });

  it('returns a resume cursor when a page is full', async () => {
    const { fake, adapter } = setup();
    fake.seed('res.partner', Array.from({ length: LIST_PAGE + 1 }, (_, i) => partner(i + 1, { write_date: '2026-01-01 00:00:05' })));
    const first = await adapter.listChangesSinceWatermark('companies', null);
    expect(JSON.parse(first.nextCursor!)).toEqual({ w: '2026-01-01 00:00:05', id: LIST_PAGE });
    const second = await adapter.listChangesSinceWatermark('companies', first.nextCursor);
    expect(second.changes.map((c) => c.id)).toEqual([`Vendor:${LIST_PAGE + 1}`]);
  });

  it('classifies transport failures on reads and updates', async () => {
    const { fake, adapter } = setup();
    fake.failNext('transport');
    await expect(adapter.getByExternalId('companies', 'Vendor:1')).rejects.toMatchObject({ code: 'external-unreachable' });
    fake.failNext('transport');
    await expect(adapter.commit({ domain: 'companies', operation: 'update', record: { id: 'c', name: 'n', type: 'Vendor', externalRecordId: 'Vendor:1' } })).rejects.toMatchObject({ code: 'external-unreachable' });
    fake.failNext('transport');
    await expect(adapter.listChangesSinceWatermark('companies', null)).rejects.toMatchObject({ code: 'external-unreachable' });
  });
});
