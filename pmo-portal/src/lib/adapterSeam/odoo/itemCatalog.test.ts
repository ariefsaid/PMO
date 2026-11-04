import { describe, expect, it } from 'vitest';
import { bindCall, type OdooCall } from './client.ts';
import { createFakeOdoo } from './fakeOdoo.ts';
import { listOdooItems } from './itemCatalog.ts';

function recordingCall(fetchImpl: typeof fetch) {
  const baseCall = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', fetchImpl });
  const calls: Array<{ model: string; method: string; body: Record<string, unknown> }> = [];
  const call: OdooCall = <T>(model: string, method: string, body: Record<string, unknown> = {}) => {
    calls.push({ model, method, body });
    return baseCall<T>(model, method, body);
  };
  return { call, calls };
}

describe('odoo/itemCatalog — client invoice item picker', () => {
  it('returns unique, enabled items scoped to the company and shared products', async () => {
    const fake = createFakeOdoo({ key: 'k' });
    fake.seed('product.product', [
      { id: 1, default_code: 'SVC-100', name: 'Implementation services', active: true, sale_ok: true, purchase_ok: true, company_id: [45, 'Company'] },
      { id: 2, default_code: 'DUPLICATE', name: 'Duplicate one', active: true, sale_ok: true, company_id: [45, 'Company'] },
      { id: 3, default_code: 'DUPLICATE', name: 'Duplicate two', active: true, sale_ok: true, company_id: [45, 'Company'] },
      { id: 4, default_code: 'PURCHASE-ONLY', name: 'Purchase only', active: true, sale_ok: false, purchase_ok: true, company_id: [45, 'Company'] },
      { id: 5, default_code: 'OTHER-COMPANY', name: 'Other company', active: true, sale_ok: true, company_id: [46, 'Other'] },
      { id: 6, default_code: 'SHARED', name: 'Shared service', active: true, sale_ok: true, company_id: false },
      { id: 7, default_code: false, name: 'Uncoded service', active: true, sale_ok: true, company_id: false },
    ]);
    const { call, calls } = recordingCall(fake.fetch);

    await expect(listOdooItems(call, 45, 'sales')).resolves.toEqual([
      { code: 'SHARED', name: 'Shared service' },
      { code: 'SVC-100', name: 'Implementation services' },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      model: 'product.product',
      method: 'search_read',
      body: {
        domain: [['active', '=', true], ['sale_ok', '=', true], ['company_id', 'in', [45, false]]],
        fields: ['default_code', 'name', 'active', 'sale_ok', 'company_id'],
        offset: 0,
        limit: 200,
        order: 'default_code asc',
      },
    });
  });

  it('paginates the full catalogue and uses the purchase eligibility flag for purchase lines', async () => {
    const fake = createFakeOdoo({ key: 'k' });
    fake.seed('product.product', Array.from({ length: 201 }, (_, index) => ({
      id: index + 1,
      default_code: `ITEM-${String(index + 1).padStart(3, '0')}`,
      name: `Item ${index + 1}`,
      active: true,
      sale_ok: false,
      purchase_ok: true,
      company_id: [45, 'Company'],
    })));
    const { call, calls } = recordingCall(fake.fetch);

    const items = await listOdooItems(call, 45, 'purchase');

    expect(items).toHaveLength(201);
    expect(items[0]).toEqual({ code: 'ITEM-001', name: 'Item 1' });
    expect(items[200]).toEqual({ code: 'ITEM-201', name: 'Item 201' });
    expect(calls).toHaveLength(2);
    expect(calls[0].body).toMatchObject({ domain: [['active', '=', true], ['purchase_ok', '=', true], ['company_id', 'in', [45, false]]], offset: 0 });
    expect(calls[1].body).toMatchObject({ offset: 200 });
  });
});
