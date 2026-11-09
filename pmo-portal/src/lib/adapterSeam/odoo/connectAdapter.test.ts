import { describe, expect, it } from 'vitest';
import { AdapterError } from '../contract.ts';
import { bindCall } from './client.ts';
import { createOdooConnectAdapter, createOdooSetupAdapter, LIST_PAGE, odooSendProbe, type OdooConnectCtx } from './connectAdapter.ts';
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

  it('counts with search_count (census is read-only), leaving out the company partners and the login partners with no trade role', async () => {
    const { fake, adapter, bodies } = setup();
    fake.seed('res.partner', [partner(1), partner(2, { active: false }), { id: 3, name: 'c', parent_id: [1, 'P1'] }, partner(4), partner(5, { supplier_rank: 0 }), partner(6, { supplier_rank: 0, active: false }), partner(7, { customer_rank: 1, supplier_rank: 0 }), partner(8)]);
    fake.seed('res.company', [{ id: 1, name: 'Own', partner_id: [4, 'P4'] }]);
    fake.seed('res.users', [{ id: 2, active: true, partner_id: [5, 'P5'] }, { id: 3, active: false, partner_id: [6, 'P6'] }, { id: 4, active: true, partner_id: [8, 'P8'] }]);
    // counted: 1, 2 (archived, still a vendor), 7, and 8 (a vendor with a portal login); left out: 4 the company's (whatever its rank), 5 and 6 logins with no role
    expect(await adapter.countDomain('party')).toBe(4);
    const count = bodies.find((b) => b.method === 'search_count')!;
    expect(count.body).toEqual({
      domain: [['parent_id', '=', false], ['id', 'not in', [4]], '!', '&', ['id', 'in', [5, 6, 8]], '&', ['supplier_rank', '=', 0], ['customer_rank', '=', 0]],
      context: { active_test: false },
    });
    expect(bodies.some((b) => ['create', 'write', 'unlink'].includes(b.method))).toBe(false);
  });

  it('a fresh database counts no partners: the built-in company, system and login partners are not the client\'s', async () => {
    const { fake, adapter } = setup();
    fake.seed('res.partner', [partner(1, { supplier_rank: 0 }), partner(2, { supplier_rank: 0 }), partner(3, { supplier_rank: 0 }), partner(4, { supplier_rank: 0 })]);
    fake.seed('res.company', [{ id: 1, name: 'My Company', partner_id: [1, 'My Company'] }]);
    // administrator, the OdooBot / public / portal-template system users (archived) and the adapter's own login
    fake.seed('res.users', [{ id: 1, active: false, partner_id: [2, 'OdooBot'] }, { id: 2, active: true, partner_id: [3, 'Administrator'] }, { id: 3, active: true, partner_id: [4, 'Adapter'] }]);
    expect(await adapter.countDomain('party')).toBe(0);
  });

  it('marks the role-less partners of login users, archived and portal ones included, as internal; a login partner that is a vendor or client is not', async () => {
    const { fake, adapter } = setup();
    fake.seed('res.partner', [partner(1), partner(2, { supplier_rank: 0 }), partner(3, { supplier_rank: 0, active: false }), partner(4, { supplier_rank: 0 }), partner(5), partner(6, { supplier_rank: 0, customer_rank: 1 })]);
    fake.seed('res.users', [{ id: 2, active: true, partner_id: [2, 'Administrator'] }, { id: 3, active: false, partner_id: [3, 'Public user'] }, { id: 4, active: true, partner_id: [5, 'Vendor portal'] }, { id: 5, active: true, partner_id: [6, 'Client portal'] }]);
    const { rows } = await adapter.listMasters('party', null);
    expect(rows.map((r) => [r.externalId, r.internal])).toEqual([['Vendor:1', false], ['2', true], ['3', true], ['4', false], ['Vendor:5', false], ['Client:6', false]]);
  });

  it('a company partner is internal whatever its trade role', async () => {
    const { fake, adapter } = setup();
    fake.seed('res.partner', [partner(1), partner(2)]);
    fake.seed('res.company', [{ id: 1, name: 'Own', partner_id: [1, 'P1'] }]);
    const { rows } = await adapter.listMasters('party', null);
    expect(rows.map((r) => [r.externalId, r.internal])).toEqual([['Vendor:1', true], ['Vendor:2', false]]);
  });

  it('reads the database\'s own partners once per adapter, not once per page', async () => {
    const { fake, adapter, bodies } = setup();
    fake.seed('res.partner', Array.from({ length: LIST_PAGE + 1 }, (_, i) => partner(i + 1)));
    const first = await adapter.listMasters('party', null);
    await adapter.listMasters('party', first.nextCursor);
    await adapter.countDomain('party');
    expect(bodies.filter((b) => b.model === 'res.users').length).toBe(1);
    expect(bodies.filter((b) => b.model === 'res.company').length).toBe(1);
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

  it('AC-ODC-052 project: a blank project number is refused before any call, so the account is never named "null <name>"', async () => {
    const { fake, adapter, bodies } = setup();
    for (const code of [null, '', '  ']) {
      await expect(adapter.sendMaster('project', { id: 'p-1', code, name: 'Jembatan' }, 'seed:project:p-1')).rejects.toEqual(new AdapterError('commit-rejected', 'project-number-missing'));
    }
    expect(bodies).toHaveLength(0);
    expect(fake.rows('account.analytic.account')).toHaveLength(0);
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

describe('odoo setup adapter (what the shared census and run see)', () => {
  const setupOf = (ctx: OdooConnectCtx = CTX) => {
    const fake = createFakeOdoo({ key: 'k' });
    const call = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', fetchImpl: fake.fetch });
    return { fake, adapter: createOdooSetupAdapter(call, ctx) };
  };

  it('AC-ECA-001 people are empty and uncounted until O7, and send nothing: an unserved kind is not an error', async () => {
    const { fake, adapter } = setupOf();
    expect(await adapter.countDomain('employee')).toBe(0);
    expect(await adapter.listMasters('employee', null)).toEqual({ rows: [], nextCursor: null });
    expect(adapter.canSend?.('employee')).toBe(false);
    expect(fake.calls).toEqual([]);
  });

  it('with no analytic plan chosen there are no cost accounts to count or list, and no project to send', async () => {
    const { fake, adapter } = setupOf({ ...CTX, analyticPlanId: null });
    expect(await adapter.countDomain('project')).toBe(0);
    expect(await adapter.listMasters('project', null)).toEqual({ rows: [], nextCursor: null });
    expect(adapter.canSend?.('project')).toBe(false);
    expect(fake.calls).toEqual([]);
  });

  it('every other kind is the Odoo adapter itself', async () => {
    const { fake, adapter } = setupOf();
    fake.seed('res.partner', [partner(1)]);
    expect(await adapter.countDomain('party')).toBe(1);
    expect((await adapter.listMasters('party', null)).rows).toHaveLength(1);
    expect(adapter.canSend?.('party')).toBe(true);
    expect(adapter.canSend?.('project')).toBe(true);
    await expect(adapter.countDomain('invoice')).rejects.toMatchObject({ code: 'commit-rejected' });
  });
});

describe('#1692 which PMO field Odoo matches its project code on', () => {
  it('an Odoo cost account\'s code carries the PMO project number (FR-ODC-072)', () => {
    const { adapter } = setup();
    expect(adapter.projectCodeField).toBe('pmo_project_number');
  });

  it('the setup adapter the run resolves declares the same field', () => {
    const fake = createFakeOdoo({ key: 'k' });
    const call = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', fetchImpl: fake.fetch });
    expect(createOdooSetupAdapter(call, CTX).projectCodeField).toBe('pmo_project_number');
  });
});

describe('odooSendProbe — the lookup half of sendMaster (S8-T1)', () => {
  it('party: an anchor hit answers the role-prefixed id; no hit is null; two hits are ambiguous', async () => {
    const { fake, call } = setup();
    expect(await odooSendProbe(call, CTX, 'party', { id: 'p1', name: 'PT Sinar Baja', role: 'vendor' })).toBeNull();
    fake.seed('res.partner', [partner(41, { ref: 'pmo:p1' }), partner(42, { ref: 'pmo:p2' })]);
    expect(await odooSendProbe(call, CTX, 'party', { id: 'p1', name: 'x', role: 'vendor' })).toEqual({ externalRecordId: 'Vendor:41' });
    expect(await odooSendProbe(call, CTX, 'party', { id: 'p2', name: 'x', role: 'client' })).toEqual({ externalRecordId: 'Client:42' });
    fake.seed('res.partner', [partner(43, { ref: 'pmo:p1' })]);
    await expect(odooSendProbe(call, CTX, 'party', { id: 'p1', name: 'x', role: 'vendor' })).rejects.toEqual(new AdapterError('commit-rejected', 'ambiguous'));
  });

  it('project: finds the code inside the plan and company; none is null; two are ambiguous', async () => {
    const { fake, call } = setup();
    const acct = (id: number, plan: number, company: number | false) => ({ id, name: 'a', code: 'PRJ-1', plan_id: [plan, 'P'], company_id: company === false ? false : [company, 'C'] });
    fake.seed('account.analytic.account', [acct(5, 7, 1), acct(6, 8, 1), acct(7, 7, 2)]);
    expect(await odooSendProbe(call, CTX, 'project', { id: 'x', name: 'x', code: 'PRJ-1' })).toEqual({ externalRecordId: '5' });
    expect(await odooSendProbe(call, CTX, 'project', { id: 'x', name: 'x', code: 'PRJ-2' })).toBeNull();
    fake.seed('account.analytic.account', [acct(8, 7, false)]);
    await expect(odooSendProbe(call, CTX, 'project', { id: 'x', name: 'x', code: 'PRJ-1' })).rejects.toEqual(new AdapterError('commit-rejected', 'ambiguous'));
  });

  it('item: a default_code hit is the id; none is null', async () => {
    const { fake, call } = setup();
    fake.seed('product.product', [{ id: 9, default_code: 'SMN-50', name: 'Semen', company_id: false }]);
    expect(await odooSendProbe(call, CTX, 'item', { id: 'i', name: 'Semen', code: 'SMN-50' })).toEqual({ externalRecordId: '9' });
    expect(await odooSendProbe(call, CTX, 'item', { id: 'i', name: 'x', code: 'NOPE' })).toBeNull();
  });

  it('is read-only: it never creates', async () => {
    const { fake, call } = setup();
    await odooSendProbe(call, CTX, 'party', { id: 'p1', name: 'x', role: 'vendor' });
    expect(fake.rows('res.partner')).toHaveLength(0);
  });
});
