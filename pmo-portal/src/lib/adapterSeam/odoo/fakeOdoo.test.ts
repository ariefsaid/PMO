import { describe, expect, it } from 'vitest';
import { bindCall, OdooError } from './client.ts';
import { createFakeOdoo } from './fakeOdoo.ts';

const setup = () => {
  const fake = createFakeOdoo({ key: 'k' });
  return { fake, call: bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', fetchImpl: fake.fetch }) };
};
const keyset = (w: string, id: number) => ['|', ['write_date', '>', w], '&', ['write_date', '=', w], ['id', '>', id]];

describe('fakeOdoo', () => {
  it('pages the §2.7 keyset domain in (write_date, id) order with no repeat across pages', async () => {
    const { fake, call } = setup();
    fake.seed('res.partner', [
      { id: 1, name: 'a', write_date: '2026-01-01 00:00:02' }, { id: 2, name: 'b', write_date: '2026-01-01 00:00:01' },
      { id: 3, name: 'c', write_date: '2026-01-01 00:00:01' }, { id: 4, name: 'd', write_date: '2026-01-01 00:00:03' },
      { id: 5, name: 'e', write_date: '2026-01-01 00:00:00' },
    ]);
    const seen: number[] = [];
    let start = { w: '2026-01-01 00:00:00', id: 5 };
    for (;;) {
      const rows = await call<{ id: number; write_date: string }[]>('res.partner', 'search_read', { domain: keyset(start.w, start.id), fields: ['id', 'write_date'], order: 'write_date asc, id asc', limit: 2 });
      if (rows.length === 0) break;
      seen.push(...rows.map((r) => r.id));
      const last = rows.at(-1)!;
      start = { w: last.write_date, id: last.id };
    }
    expect(seen).toEqual([2, 3, 1, 4]);
  });

  it('a lost-response create leaves exactly one row and the caller sees a transport failure', async () => {
    const { fake, call } = setup();
    fake.failNext('lost-response');
    await expect(call('res.partner', 'create', { vals_list: [{ name: 'x', ref: 'pmo:1' }] })).rejects.toMatchObject({ errorClass: 'unreachable' });
    expect(fake.rows('res.partner')).toHaveLength(1);
    expect(await call('res.partner', 'search_read', { domain: [['ref', '=', 'pmo:1']], fields: ['id'] })).toHaveLength(1);
  });

  it('a transport failure writes nothing', async () => {
    const { fake, call } = setup();
    fake.failNext('transport');
    await expect(call('res.partner', 'create', { vals_list: [{ name: 'x' }] })).rejects.toBeInstanceOf(OdooError);
    expect(fake.rows('res.partner')).toEqual([]);
  });

  it('answers 401 for a wrong key', async () => {
    const fake = createFakeOdoo({ key: 'k' });
    const call = bindCall({ baseUrl: 'https://o.test', apiKey: 'wrong', database: 'db1', fetchImpl: fake.fetch });
    await expect(call('res.partner', 'search', { domain: [] })).rejects.toMatchObject({ errorClass: 'key-rejected' });
  });

  it('create stamps ids and write_date; write bumps write_date; unlink removes; counts and searches honour active_test', async () => {
    const { fake, call } = setup();
    const [id] = await call<number[]>('res.partner', 'create', { vals_list: [{ name: 'PT A', active: false }] });
    const before = fake.rows('res.partner')[0].write_date as string;
    expect(await call('res.partner', 'write', { ids: [id], vals: { name: 'PT B' } })).toBe(true);
    expect(fake.rows('res.partner')[0]).toMatchObject({ name: 'PT B' });
    expect((fake.rows('res.partner')[0].write_date as string) > before).toBe(true);
    expect(await call('res.partner', 'search_count', { domain: [] })).toBe(0);
    expect(await call('res.partner', 'search_count', { domain: [], context: { active_test: false } })).toBe(1);
    expect(await call('res.partner', 'search', { domain: [['name', 'ilike', 'pt b']], context: { active_test: false } })).toEqual([id]);
    await call('res.partner', 'unlink', { ids: [id] });
    expect(fake.rows('res.partner')).toEqual([]);
  });

  it('matches many2one values by id and supports in, >=, & and offset', async () => {
    const { fake, call } = setup();
    fake.seed('account.analytic.account', [
      { id: 1, name: 'a', plan_id: [7, 'Projects'], company_id: false }, { id: 2, name: 'b', plan_id: [7, 'Projects'], company_id: [1, 'Co'] },
      { id: 3, name: 'c', plan_id: [8, 'Other'], company_id: [1, 'Co'] }, { id: 4, name: 'd', plan_id: [7, 'Projects'], company_id: [2, 'Co2'] },
    ]);
    const ids = await call('account.analytic.account', 'search', { domain: ['&', ['plan_id', '=', 7], ['company_id', 'in', [1, false]], ['id', '>=', 1]] });
    expect(ids).toEqual([1, 2]);
    expect(await call('account.analytic.account', 'search', { domain: [], offset: 1, limit: 2 })).toEqual([2, 3]);
  });

  it('answers fields_get with the declared fields and 404 JSON for an unknown method', async () => {
    const { call } = setup();
    expect(Object.keys(await call<Record<string, unknown>>('res.partner', 'fields_get', {}))).toContain('supplier_rank');
    await expect(call('res.partner', 'no_such_method', {})).rejects.toMatchObject({ errorClass: 'missing-model' });
  });

  it('aggregates grouped move lines in group order without float drift and respects domain', async () => {
    const { fake, call } = setup();
    fake.seed('account.move.line', [
      { id: 1, account_id: [101, '101000 Cash'], debit: 0.1, credit: 0.05 },
      { id: 2, account_id: [101, '101000 Cash'], debit: 0.2, credit: 0.15 },
      { id: 3, account_id: [201, '201000 Accounts Payable'], debit: 15.25, credit: 10.1 },
      { id: 4, account_id: [201, '201000 Accounts Payable'], debit: 5.75, credit: 20.2 },
      { id: 5, account_id: [201, '201000 Accounts Payable'], debit: 100, credit: 100 },
    ]);

    const groups = await call<Array<Record<string, unknown>>>('account.move.line', 'formatted_read_group', {
      groupby: ['account_id'],
      aggregates: ['debit:sum', 'credit:sum'],
      domain: [['id', '!=', 5]],
    });

    expect(groups).toEqual([
      {
        account_id: [101, '101000 Cash'],
        'debit:sum': 0.3,
        'credit:sum': 0.2,
      },
      {
        account_id: [201, '201000 Accounts Payable'],
        'debit:sum': 21,
        'credit:sum': 30.3,
      },
    ]);
  });
  describe('fleet and maintenance models (bed claims V-OFM-1, -5, -6)', () => {
    it('AC-OFM-010 answers fields_get for the seven asset models and has_access for them', async () => {
      const { call } = setup();
      for (const model of ['fleet.vehicle', 'fleet.vehicle.model', 'maintenance.equipment', 'maintenance.request', 'maintenance.stage', 'fleet.vehicle.log.services', 'fleet.service.type']) {
        expect(Object.keys(await call<Record<string, unknown>>(model, 'fields_get', {})), model).toContain('write_date');
        expect(await call(model, 'has_access', { operation: 'create' }), model).toBe(true);
      }
      expect(Object.keys(await call<Record<string, unknown>>('maintenance.request', 'fields_get', {}))).toContain('archive');
    });

    it('AC-OFM-010 a write bumps write_date on an asset model', async () => {
      const { fake, call } = setup();
      const [id] = await call<number[]>('maintenance.equipment', 'create', { vals_list: [{ name: 'Excavator 20t', serial_no: 'EXC-001' }] });
      const before = fake.rows('maintenance.equipment')[0].write_date as string;
      await call('maintenance.equipment', 'write', { ids: [id], vals: { name: 'Excavator 21t' } });
      expect((fake.rows('maintenance.equipment')[0].write_date as string) > before).toBe(true);
    });

    it('AC-OFM-090 moving a request to a done stage sets close_date, and a not-done stage does not', async () => {
      const { fake, call } = setup();
      fake.seed('maintenance.stage', [{ id: 1, name: 'New Request', sequence: 1, done: false }, { id: 4, name: 'Repaired', sequence: 30, done: true }]);
      const [id] = await call<number[]>('maintenance.request', 'create', { vals_list: [{ name: 'Hydraulic leak', stage_id: 1 }] });
      await call('maintenance.request', 'write', { ids: [id], vals: { stage_id: 1 } });
      expect(fake.rows('maintenance.request')[0].close_date ?? false).toBe(false);
      await call('maintenance.request', 'write', { ids: [id], vals: { stage_id: 4 } });
      expect(fake.rows('maintenance.request')[0].close_date).toMatch(/^\d{4}-\d{2}-\d{2}/);
    });

    it('AC-OFM-010 a vehicle without a model, and a service log without a service type, are refused as Odoo refuses them', async () => {
      const { fake, call } = setup();
      await expect(call('fleet.vehicle', 'create', { vals_list: [{ name: 'Hilux', license_plate: 'B 1234 XY' }] })).rejects.toBeInstanceOf(OdooError);
      await expect(call('fleet.vehicle.log.services', 'create', { vals_list: [{ vehicle_id: 7 }] })).rejects.toBeInstanceOf(OdooError);
      expect(fake.rows('fleet.vehicle')).toEqual([]);
      expect(fake.rows('fleet.vehicle.log.services')).toEqual([]);
      await call('fleet.vehicle', 'create', { vals_list: [{ name: 'Hilux', model_id: 3 }] });
      expect(fake.rows('fleet.vehicle')).toHaveLength(1);
    });
  });
});
