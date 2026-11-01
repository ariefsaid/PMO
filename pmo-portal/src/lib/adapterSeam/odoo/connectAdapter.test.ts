import { describe, expect, it } from 'vitest';
import { AdapterError } from '../contract.ts';
import { bindCall } from './client.ts';
import { createOdooConnectAdapter, LIST_PAGE, type OdooConnectCtx } from './connectAdapter.ts';
import { createFakeOdoo } from './fakeOdoo.ts';

const CTX: OdooConnectCtx = { companyId: 1, analyticPlanId: 7, unitMap: { sak: '11' } };
const setup = (ctx: OdooConnectCtx = CTX) => {
  const fake = createFakeOdoo({ key: 'k' });
  const call = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', fetchImpl: fake.fetch });
  const bodies: Array<{ model: string; method: string; body: Record<string, unknown> }> = [];
  const spy = (async (url: string, init: RequestInit) => {
    const [, model, method] = /\/json\/2\/([^/]+)\/([^/]+)$/.exec(url)!;
    bodies.push({ model, method, body: JSON.parse(String(init.body)) });
    return fake.fetch(url, init);
  }) as unknown as typeof fetch;
  const spied = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', fetchImpl: spy });
  return { fake, call, bodies, adapter: createOdooConnectAdapter(spied, ctx) };
};
const partner = (id: number, extra: Record<string, unknown> = {}) =>
  ({ id, name: `P${id}`, vat: false, ref: false, is_company: true, parent_id: false, active: true, supplier_rank: 1, customer_rank: 0, ...extra });

describe('odoo ConnectAdapter — listMasters / countDomain', () => {
  it('pages parties by id with active_test off and returns normalised rows, null cursor on the last page', async () => {
    const { fake, adapter, bodies } = setup();
    fake.seed('res.partner', Array.from({ length: LIST_PAGE + 1 }, (_, i) => partner(i + 1, { active: i !== 0 })));
    fake.seed('res.partner', [{ id: 900, name: 'contact', is_company: false, parent_id: [1, 'P1'] }]);
    const first = await adapter.listMasters('party', null);
    expect(first.rows).toHaveLength(LIST_PAGE);
    expect(first.rows[0]).toMatchObject({ externalId: 'Vendor:1', active: false });
    expect(first.nextCursor).toBe(String(LIST_PAGE));
    const second = await adapter.listMasters('party', first.nextCursor);
    expect(second.rows.map((r) => r.externalId)).toEqual([`Vendor:${LIST_PAGE + 1}`]);
    expect(second.nextCursor).toBeNull();
    const read = bodies.find((b) => b.model === 'res.partner' && b.method === 'search_read')!;
    expect(read.body).toMatchObject({ order: 'id asc', limit: LIST_PAGE, context: { active_test: false } });
  });

  it('marks the partners of the database\'s companies as internal', async () => {
    const { fake, adapter } = setup();
    fake.seed('res.partner', [partner(1), partner(2)]);
    fake.seed('res.company', [{ id: 1, name: 'Own', partner_id: [2, 'P2'] }]);
    const { rows } = await adapter.listMasters('party', null);
    expect(rows.map((r) => [r.externalId, r.internal])).toEqual([['Vendor:1', false], ['Vendor:2', true]]);
  });

  it('lists only cost accounts of the configured plan whose company is ours or unset', async () => {
    const { fake, adapter } = setup();
    fake.seed('account.analytic.account', [
      { id: 1, name: 'a', code: 'A', plan_id: [7, 'P'], company_id: false }, { id: 2, name: 'b', code: 'B', plan_id: [7, 'P'], company_id: [1, 'C'] },
      { id: 3, name: 'c', code: 'C', plan_id: [8, 'X'], company_id: [1, 'C'] }, { id: 4, name: 'd', code: 'D', plan_id: [7, 'P'], company_id: [2, 'C2'] },
    ]);
    expect((await adapter.listMasters('project', null)).rows.map((r) => r.code)).toEqual(['A', 'B']);
  });

  it('counts with search_count over the same domain as listMasters (census is read-only)', async () => {
    const { fake, adapter, bodies } = setup();
    fake.seed('res.partner', [partner(1), partner(2, { active: false }), { id: 3, name: 'c', parent_id: [1, 'P1'] }]);
    expect(await adapter.countDomain('party')).toBe(2);
    const count = bodies.find((b) => b.method === 'search_count')!;
    expect(count.body).toEqual({ domain: [['parent_id', '=', false]], context: { active_test: false } });
    expect(bodies.some((b) => ['create', 'write', 'unlink'].includes(b.method))).toBe(false);
  });

  it('refuses a kind it does not model, and a project listing with no plan chosen, before any call', async () => {
    const { adapter, bodies } = setup({ ...CTX, analyticPlanId: null });
    await expect(adapter.listMasters('employee', null)).rejects.toMatchObject({ code: 'commit-rejected' });
    await expect(adapter.listMasters('project', null)).rejects.toMatchObject({ code: 'commit-rejected', message: 'analytic-plan-unset' });
    expect(bodies).toEqual([]);
  });
});

describe('odoo ConnectAdapter — sendMaster (lookup-then-create)', () => {
  it('party: no anchor hit → one create carrying the pmo ref and the role rank', async () => {
    const { fake, adapter, bodies } = setup();
    const { externalId } = await adapter.sendMaster('party', { id: 'c-1', name: 'PT Baru', taxId: '02', role: 'vendor' }, 'seed:party:c-1');
    expect(bodies[0]).toMatchObject({ method: 'search_read', body: { domain: [['ref', '=', 'pmo:c-1']] } });
    expect(bodies[1]).toMatchObject({ method: 'create', body: { vals_list: [{ name: 'PT Baru', vat: '02', ref: 'pmo:c-1', is_company: true, supplier_rank: 1 }] } });
    expect(externalId).toBe(`Vendor:${fake.rows('res.partner')[0].id}`);
  });

  it('party: a client gets customer_rank and a Client: id; an anchor hit creates nothing', async () => {
    const { fake, adapter } = setup();
    const first = await adapter.sendMaster('party', { id: 'c-2', name: 'PT Klien', role: 'client' }, 'seed:party:c-2');
    expect(fake.rows('res.partner')[0]).toMatchObject({ customer_rank: 1, vat: false });
    expect(first.externalId).toMatch(/^Client:\d+$/);
    expect(await adapter.sendMaster('party', { id: 'c-2', name: 'PT Klien', role: 'client' }, 'seed:party:c-2')).toEqual(first);
    expect(fake.rows('res.partner')).toHaveLength(1);
  });

  it('party: two anchor hits → ambiguous, no create', async () => {
    const { fake, adapter } = setup();
    fake.seed('res.partner', [partner(1, { ref: 'pmo:c-1' }), partner(2, { ref: 'pmo:c-1', active: false })]);
    await expect(adapter.sendMaster('party', { id: 'c-1', name: 'x', role: 'vendor' }, 'k')).rejects.toEqual(new AdapterError('commit-rejected', 'ambiguous'));
    expect(fake.rows('res.partner')).toHaveLength(2);
  });

  it('project: looks up the code inside the plan and company before creating the cost account', async () => {
    const { fake, adapter, bodies } = setup();
    const { externalId } = await adapter.sendMaster('project', { id: 'p-1', code: 'PRJ-26-0001', name: 'Jembatan' }, 'seed:project:p-1');
    expect(bodies[0].body.domain).toEqual([['code', '=', 'PRJ-26-0001'], ['plan_id', '=', 7], ['company_id', 'in', [1, false]]]);
    expect(fake.rows('account.analytic.account')[0]).toMatchObject({ name: 'PRJ-26-0001 Jembatan', code: 'PRJ-26-0001', plan_id: 7, company_id: 1 });
    expect(externalId).toBe(String(fake.rows('account.analytic.account')[0].id));
    expect(await adapter.sendMaster('project', { id: 'p-1', code: 'PRJ-26-0001', name: 'Jembatan' }, 'seed:project:p-1')).toEqual({ externalId });
    expect(fake.rows('account.analytic.account')).toHaveLength(1);
  });

  it('item: looks up default_code within our company; create carries the mapped unit and purchase_ok', async () => {
    const { fake, adapter, bodies } = setup();
    await adapter.sendMaster('item', { id: 'i-1', code: 'SMN-50', name: 'Semen 50 kg', unit: 'sak' }, 'seed:item:i-1');
    expect(bodies[0].body.domain).toEqual([['default_code', '=', 'SMN-50'], ['company_id', 'in', [1, false]]]);
    expect(fake.rows('product.product')[0]).toMatchObject({ default_code: 'SMN-50', name: 'Semen 50 kg', purchase_ok: true, uom_id: 11 });
  });

  it('item: an unmapped unit is refused before any call', async () => {
    const { adapter, bodies } = setup();
    await expect(adapter.sendMaster('item', { id: 'i-1', code: 'X', name: 'X', unit: 'drum' }, 'k')).rejects.toEqual(new AdapterError('commit-rejected', 'unit-unmapped'));
    expect(bodies).toEqual([]);
  });

  it('a lost response then a retry with the same key leaves one record and the same id', async () => {
    const { fake, adapter } = setup();
    fake.seed('res.partner', []);
    // the lookup succeeds; the create is applied but its answer is lost
    const realFetch = fake.fetch;
    let n = 0;
    const lossy = createOdooConnectAdapter(bindCall({ baseUrl: 'https://o.test', apiKey: 'k', database: 'db1', fetchImpl: (async (u: string, i: RequestInit) => {
      if (++n === 2) fake.failNext('lost-response');
      return realFetch(u, i);
    }) as unknown as typeof fetch }), CTX);
    await expect(lossy.sendMaster('party', { id: 'c-9', name: 'PT L', role: 'vendor' }, 'seed:party:c-9')).rejects.toMatchObject({ code: 'external-unreachable' });
    const retry = await adapter.sendMaster('party', { id: 'c-9', name: 'PT L', role: 'vendor' }, 'seed:party:c-9');
    expect(fake.rows('res.partner')).toHaveLength(1);
    expect(retry.externalId).toBe(`Vendor:${fake.rows('res.partner')[0].id}`);
  });

  it('classifies a transport failure as external-unreachable and a 422 as commit-rejected with fixed text', async () => {
    const { fake, adapter } = setup();
    fake.failNext('transport');
    await expect(adapter.sendMaster('party', { id: 'c-1', name: 'x', role: 'vendor' }, 'k')).rejects.toEqual(new AdapterError('external-unreachable', 'unreachable'));
    const rejecting = createOdooConnectAdapter(bindCall({ baseUrl: 'https://o.test', apiKey: 'k', database: 'db1',
      fetchImpl: (async () => Response.json({ name: 'odoo.exceptions.ValidationError', message: 'secret detail' }, { status: 422 })) as unknown as typeof fetch }), CTX);
    await expect(rejecting.sendMaster('party', { id: 'c-1', name: 'x', role: 'vendor' }, 'k')).rejects.toEqual(new AdapterError('commit-rejected', 'validation'));
  });

  it('refuses to send a kind it does not create', async () => {
    const { adapter } = setup();
    await expect(adapter.sendMaster('account', { id: 'a', name: 'a' }, 'k')).rejects.toMatchObject({ code: 'commit-rejected' });
  });
});
