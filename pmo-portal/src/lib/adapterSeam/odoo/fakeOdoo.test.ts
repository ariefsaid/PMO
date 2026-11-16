import { describe, expect, it } from 'vitest';
import { bindCall, OdooError } from './client.ts';
import { createFakeOdoo } from './fakeOdoo.ts';

const setup = () => {
  const fake = createFakeOdoo({ key: 'k' });
  return { fake, call: bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', fetchImpl: fake.fetch }) };
};
const keyset = (w: string, id: number) => ['|', ['write_date', '>', w], '&', ['write_date', '=', w], ['id', '>', id]];

describe('fakeOdoo', () => {
  it('answers `not in`, and reads res.users with its partner link', async () => {
    const { fake, call } = setup();
    fake.seed('res.partner', [{ id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3, name: 'c' }]);
    fake.seed('res.users', [{ id: 1, active: false, partner_id: [2, 'b'] }]);
    expect(await call('res.partner', 'search', { domain: [['id', 'not in', [2, 3]]] })).toEqual([1]);
    expect(await call('res.users', 'search_read', { domain: [], fields: ['partner_id'], context: { active_test: false } })).toEqual([{ id: 1, partner_id: [2, 'b'] }]);
  });

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
      expect(Object.keys(await call<Record<string, unknown>>('maintenance.request', 'fields_get', {}))).toContain('state');
      expect(Object.keys(await call<Record<string, unknown>>('maintenance.request', 'fields_get', {}))).toContain('schedule_end');
      // #2174: Odoo 20 has no request archive flag, no request_date, no stage `done`, and no free-text equipment location.
      expect(Object.keys(await call<Record<string, unknown>>('maintenance.request', 'fields_get', {}))).not.toContain('archive');
      expect(Object.keys(await call<Record<string, unknown>>('maintenance.request', 'fields_get', {}))).not.toContain('active');
      expect(Object.keys(await call<Record<string, unknown>>('maintenance.stage', 'fields_get', {}))).not.toContain('done');
      expect(Object.keys(await call<Record<string, unknown>>('maintenance.equipment', 'fields_get', {}))).not.toContain('location');
      // V-OFM-2 on the bed: Odoo 20's fleet.vehicle.model declares a company field.
      expect(Object.keys(await call<Record<string, unknown>>('fleet.vehicle.model', 'fields_get', {}))).toContain('company_id');
    });

    it('AC-OFM-010 a write bumps write_date on an asset model', async () => {
      const { fake, call } = setup();
      const [id] = await call<number[]>('maintenance.equipment', 'create', { vals_list: [{ name: 'Excavator 20t', serial_no: 'EXC-001' }] });
      const before = fake.rows('maintenance.equipment')[0].write_date as string;
      await call('maintenance.equipment', 'write', { ids: [id], vals: { name: 'Excavator 21t' } });
      expect((fake.rows('maintenance.equipment')[0].write_date as string) > before).toBe(true);
    });

    // #2174 (Odoo 20 `MaintenanceRequest.write`): moving a request between stages closes nothing; `state = done` closes it,
    // and leaving `done` clears the close date again.
    it('AC-OFM-090 a request set to done is closed, a stage change alone is not, and leaving done clears the close date', async () => {
      const { fake, call } = setup();
      fake.seed('maintenance.stage', [{ id: 1, name: 'New Request', sequence: 1 }, { id: 4, name: 'Repaired', sequence: 30 }]);
      const [id] = await call<number[]>('maintenance.request', 'create', { vals_list: [{ name: 'Hydraulic leak', stage_id: 1 }] });
      await call('maintenance.request', 'write', { ids: [id], vals: { stage_id: 4 } });
      expect(fake.rows('maintenance.request')[0].close_date ?? false).toBe(false);
      await call('maintenance.request', 'write', { ids: [id], vals: { stage_id: 4, state: 'done' } });
      expect(fake.rows('maintenance.request')[0].close_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      await call('maintenance.request', 'write', { ids: [id], vals: { state: 'normal' } });
      expect(fake.rows('maintenance.request')[0].close_date).toBe(false);
    });

    // Odoo 20 derives both from the window (`_compute_schedule_end` / `_compute_duration`): an explicit end survives, and
    // the duration is the window's length — never a `duration` a caller wrote (#2174).
    it('AC-OFM-090 a request’s duration is the length of its scheduled window, as Odoo 20 computes it', async () => {
      const { fake, call } = setup();
      const [id] = await call<number[]>('maintenance.request', 'create', { vals_list: [{ name: 'Hydraulic leak', schedule_date: '2026-11-10 01:00:00', schedule_end: '2026-11-10 03:30:00' }] });
      expect(fake.rows('maintenance.request')[0]).toMatchObject({ schedule_end: '2026-11-10 03:30:00', duration: 2.5 });
      // A start alone gets Odoo's own +1 h end, so a duration a caller wrote beside it is not what Odoo holds.
      const [other] = await call<number[]>('maintenance.request', 'create', { vals_list: [{ name: 'Hydraulic leak 2', schedule_date: '2026-11-10 01:00:00', duration: 2.5 }] });
      expect(fake.rows('maintenance.request').find((r) => r.id === other)).toMatchObject({ schedule_end: '2026-11-10 02:00:00', duration: 1 });
      await call('maintenance.request', 'write', { ids: [id], vals: { schedule_date: '2026-11-11 01:00:00', schedule_end: '2026-11-11 04:00:00' } });
      expect(fake.rows('maintenance.request')[0]).toMatchObject({ duration: 3 });
    });

    it('AC-OFM-010 a service log without a service type is refused as Odoo refuses it, and a vehicle without a model is accepted', async () => {
      const { fake, call } = setup();
      await expect(call('fleet.vehicle.log.services', 'create', { vals_list: [{ vehicle_id: 7 }] })).rejects.toBeInstanceOf(OdooError);
      expect(fake.rows('fleet.vehicle.log.services')).toEqual([]);
      // Odoo 20's `fleet_vehicle.py` declares `model_id` without `required=True` (V-OFM-1 on the bed).
      await call('fleet.vehicle', 'create', { vals_list: [{ name: 'Hilux', license_plate: 'B 1234 XY' }] });
      expect(fake.rows('fleet.vehicle')).toHaveLength(1);
      await call('fleet.vehicle', 'create', { vals_list: [{ name: 'Hilux 2', model_id: 3 }] });
      expect(fake.rows('fleet.vehicle')).toHaveLength(2);
    });
  });

  // #2174's defect class (review Important-1): real Odoo refuses a field the model does not have on every verb, so a
  // stale or misspelled field name cannot pass green here and then 500 at a user's first real write. Since #2273 the
  // strictness covers EVERY model that declares a field list; these fleet and maintenance refusals were the first covered.
  describe('strict field names on the fleet and maintenance models', () => {
    it('create refuses an unknown field and writes nothing', async () => {
      const { fake, call } = setup();
      await expect(call('maintenance.equipment', 'create', { vals_list: [{ name: 'Pump', location: 'Site A' }] }))
        .rejects.toMatchObject({ errorClass: 'validation' });
      expect(fake.rows('maintenance.equipment')).toEqual([]);
    });

    it('write refuses an unknown field and changes nothing', async () => {
      const { fake, call } = setup();
      const [id] = await call<number[]>('maintenance.equipment', 'create', { vals_list: [{ name: 'Pump' }] });
      await expect(call('maintenance.equipment', 'write', { ids: [id], vals: { location: 'Site A' } }))
        .rejects.toMatchObject({ errorClass: 'validation' });
      expect(fake.rows('maintenance.equipment')[0]).not.toHaveProperty('location');
    });

    it('read refuses an unknown requested field', async () => {
      const { call } = setup();
      await expect(call('maintenance.equipment', 'read', { ids: [1], fields: ['name', 'location'] }))
        .rejects.toMatchObject({ errorClass: 'validation' });
    });

    it('search_read refuses an unknown requested field', async () => {
      const { call } = setup();
      await expect(call('maintenance.equipment', 'search_read', { domain: [], fields: ['name', 'location'] }))
        .rejects.toMatchObject({ errorClass: 'validation' });
    });

    // The review's fidelity sub-note: Odoo 20's request `state` is a selection; the fake refuses a write outside it,
    // and a request created `done` closes exactly as Odoo's own create does (`maintenance.py:447`).
    it('a request write with a state outside the selection is refused', async () => {
      const { fake, call } = setup();
      const [id] = await call<number[]>('maintenance.request', 'create', { vals_list: [{ name: 'Hydraulic leak' }] });
      await expect(call('maintenance.request', 'write', { ids: [id], vals: { state: 'finished' } }))
        .rejects.toMatchObject({ errorClass: 'validation' });
      expect(fake.rows('maintenance.request')[0].state ?? false).toBe(false);
    });

    it('a request created done sets close_date as Odoo’s create does', async () => {
      const { fake, call } = setup();
      const [id] = await call<number[]>('maintenance.request', 'create', { vals_list: [{ name: 'Hydraulic leak', state: 'done' }] });
      expect(fake.rows('maintenance.request').find((r) => r.id === id))
        .toMatchObject({ state: 'done', close_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    });
  });

  // #2273: the strictness now covers every declared model, the money and directory lists included, so a stale field
  // name on a purchase or a partner fails here instead of 500-ing at the first real write. The fields the #2273 sweep
  // added (`purchase.order.currency_id`, `account.payment.name`/`currency_id`) are bed-verified Odoo 20 fields.
  describe('strict field names on every declared model (#2273)', () => {
    it('a money model refuses an unknown field on create, write, read and search_read', async () => {
      const { fake, call } = setup();
      const [id] = await call<number[]>('purchase.order', 'create', { vals_list: [{ partner_id: 3 }] });
      await expect(call('purchase.order', 'create', { vals_list: [{ partner_id: 4, phone: '+62 21 555 0100' }] }))
        .rejects.toMatchObject({ errorClass: 'validation' });
      expect(fake.rows('purchase.order')).toHaveLength(1);
      await expect(call('purchase.order', 'write', { ids: [id], vals: { phone: '+62 21 555 0100' } }))
        .rejects.toMatchObject({ errorClass: 'validation' });
      expect(fake.rows('purchase.order').find((r) => r.id === id)).not.toHaveProperty('phone');
      await expect(call('purchase.order', 'read', { ids: [id], fields: ['name', 'phone'] }))
        .rejects.toMatchObject({ errorClass: 'validation' });
      await expect(call('purchase.order', 'search_read', { domain: [], fields: ['name', 'phone'] }))
        .rejects.toMatchObject({ errorClass: 'validation' });
    });

    it('a directory model refuses an unknown field on create, write, read and search_read', async () => {
      const { fake, call } = setup();
      const [id] = await call<number[]>('res.partner', 'create', { vals_list: [{ name: 'PT A' }] });
      await expect(call('res.partner', 'create', { vals_list: [{ name: 'PT B', phone: '+62 21 555 0100' }] }))
        .rejects.toMatchObject({ errorClass: 'validation' });
      expect(fake.rows('res.partner')).toHaveLength(1);
      await expect(call('res.partner', 'write', { ids: [id], vals: { phone: '+62 21 555 0100' } }))
        .rejects.toMatchObject({ errorClass: 'validation' });
      expect(fake.rows('res.partner').find((r) => r.id === id)).not.toHaveProperty('phone');
      await expect(call('res.partner', 'read', { ids: [id], fields: ['name', 'phone'] }))
        .rejects.toMatchObject({ errorClass: 'validation' });
      await expect(call('res.partner', 'search_read', { domain: [], fields: ['name', 'phone'] }))
        .rejects.toMatchObject({ errorClass: 'validation' });
    });

    it('the currency and order date the adapters send on purchase.order are accepted and read back', async () => {
      const { call } = setup();
      const [id] = await call<number[]>('purchase.order', 'create', { vals_list: [{ partner_id: 3, currency_id: 2, date_order: '2026-01-05 08:00:00' }] });
      expect((await call<Record<string, unknown>[]>('purchase.order', 'read', { ids: [id], fields: ['name', 'currency_id', 'date_order'] }))[0])
        .toMatchObject({ currency_id: 2, date_order: '2026-01-05 08:00:00' });
      await call('purchase.order', 'write', { ids: [id], vals: { currency_id: 7, date_order: '2026-02-01 09:00:00' } });
      expect(await call('purchase.order', 'search_read', { domain: [['currency_id', '=', 7]], fields: ['currency_id', 'date_order'] }))
        .toEqual([{ id, currency_id: 7, date_order: '2026-02-01 09:00:00' }]);
    });

    it('the company year end the ledger feed reads is accepted and reads back', async () => {
      const { call } = setup();
      const [id] = await call<number[]>('res.company', 'create', { vals_list: [{ name: 'Co', fiscalyear_last_day: 31, fiscalyear_last_month: '3' }] });
      expect((await call<Record<string, unknown>[]>('res.company', 'read', { ids: [id], fields: ['fiscalyear_last_day', 'fiscalyear_last_month'] }))[0])
        .toEqual({ id, fiscalyear_last_day: 31, fiscalyear_last_month: '3' });
      await call('res.company', 'write', { ids: [id], vals: { fiscalyear_last_month: '12' } });
      expect(await call('res.company', 'search_read', { domain: [], fields: ['fiscalyear_last_day', 'fiscalyear_last_month'] }))
        .toEqual([{ id, fiscalyear_last_day: 31, fiscalyear_last_month: '12' }]);
    });

    it('the receipt vendor the purchase sweep reads is accepted and reads back', async () => {
      const { call } = setup();
      const [id] = await call<number[]>('stock.picking', 'create', { vals_list: [{ name: 'WH/IN/00001', partner_id: 5 }] });
      expect((await call<Record<string, unknown>[]>('stock.picking', 'read', { ids: [id], fields: ['partner_id'] }))[0])
        .toEqual({ id, partner_id: 5 });
      await call('stock.picking', 'write', { ids: [id], vals: { partner_id: 7 } });
      expect(await call('stock.picking', 'search_read', { domain: [['partner_id', '=', 7]], fields: ['partner_id'] }))
        .toEqual([{ id, partner_id: 7 }]);
    });

    it('the name and currency the adapters send on account.payment are accepted and read back', async () => {
      const { call } = setup();
      const [id] = await call<number[]>('account.payment', 'create', { vals_list: [{ payment_type: 'inbound', partner_type: 'customer', amount: 5, name: 'PBNK1/2026/00001', currency_id: 2 }] });
      expect((await call<Record<string, unknown>[]>('account.payment', 'read', { ids: [id], fields: ['name', 'currency_id'] }))[0])
        .toEqual({ id, name: 'PBNK1/2026/00001', currency_id: 2 });
      await call('account.payment', 'write', { ids: [id], vals: { name: 'PBNK1/2026/00002', currency_id: 7 } });
      expect(await call('account.payment', 'search_read', { domain: [], fields: ['name', 'currency_id'] }))
        .toEqual([{ id, name: 'PBNK1/2026/00002', currency_id: 7 }]);
    });
  });
});

/**
 * #895 manual journals: the fake mirrors the dev-bed facts recorded in
 * `supabase/functions/_shared/odooAccountantsDeskFacts.bed.test.ts` (branch spike/accountants-desk-odoo-facts):
 * V-ACD1 (entry create, unbalanced refusal, the same ref twice), V-ACD2 (account.move.reversal + refund_moves, a second reversal
 * accepted) and V-ACD4 (a post dated inside fiscalyear_lock_date is re-dated to the day after the lock, silently).
 */
describe('fakeOdoo manual journal entries (V-ACD1, V-ACD2, V-ACD4)', () => {
  const journal = (fake: ReturnType<typeof createFakeOdoo>) => {
    fake.seed('res.company', [{ id: 1, name: 'Co' }]);
    fake.seed('account.journal', [{ id: 9, name: 'Miscellaneous', code: 'MISC', type: 'general' }]);
  };
  const entry = (date: string, ref: string, credit = 100) => ({
    move_type: 'entry', journal_id: 9, date, ref,
    line_ids: [[0, 0, { account_id: 601, debit: 100, credit: 0, name: 'fee' }], [0, 0, { account_id: 101, debit: 0, credit, name: 'bank' }]],
  });
  const bed = (today = '2026-11-15') => {
    const fake = createFakeOdoo({ key: 'k', today });
    journal(fake);
    return { fake, call: bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', fetchImpl: fake.fetch }) };
  };

  it('V-ACD1 refuses an unbalanced entry with a 422 and keeps nothing', async () => {
    const { fake, call } = bed();
    const err = await call('account.move', 'create', { vals_list: [entry('2026-11-10', 'x', 90)] }).catch((e) => e);
    expect(err).toBeInstanceOf(OdooError);
    expect((err as OdooError).status).toBe(422);
    expect(fake.rows('account.move')).toEqual([]);
    expect(fake.rows('account.move.line')).toEqual([]);
  });

  it('V-ACD1 accepts the same ref twice and posts both (so ref is never an anchor)', async () => {
    const { fake, call } = bed();
    const [a] = await call<number[]>('account.move', 'create', { vals_list: [entry('2026-11-10', 'same')] });
    const [b] = await call<number[]>('account.move', 'create', { vals_list: [entry('2026-11-10', 'same')] });
    await call('account.move', 'action_post', { ids: [a, b] });
    expect(fake.rows('account.move').filter((m) => m.ref === 'same' && m.state === 'posted').map((m) => m.id)).toEqual([a, b]);
    expect(await call('account.move.line', 'search_read', { domain: [['move_id', '=', a]], fields: ['account_id', 'debit', 'credit'] }))
      .toEqual([{ id: expect.any(Number), account_id: 601, debit: 100, credit: 0 }, { id: expect.any(Number), account_id: 101, debit: 0, credit: 100 }]);
  });

  it('V-ACD4 a post dated inside fiscalyear_lock_date is re-dated to the day after the lock', async () => {
    const { fake, call } = bed();
    fake.seed('res.company', [{ id: 1, name: 'Co', fiscalyear_lock_date: '2026-01-31' }]);
    const [id] = await call<number[]>('account.move', 'create', { vals_list: [entry('2026-01-20', 'locked')] });
    await call('account.move', 'action_post', { ids: [id] });
    expect(await call('account.move', 'read', { ids: [id], fields: ['date', 'state'] })).toEqual([{ id, date: '2026-02-01', state: 'posted' }]);
  });

  it('V-ACD2 account.move.reversal + refund_moves returns res_id, links both ways, swaps sides and accepts a second reversal', async () => {
    const { fake, call } = bed();
    const [orig] = await call<number[]>('account.move', 'create', { vals_list: [entry('2026-11-10', 'orig')] });
    await call('account.move', 'action_post', { ids: [orig] });
    const reverse = async (date: string) => {
      const ctx = { active_model: 'account.move', active_ids: [orig] };
      const [w] = await call<number[]>('account.move.reversal', 'create', { vals_list: [{ journal_id: 9, date, reason: 'wrong account' }], context: ctx });
      return call<{ res_model: string; res_id: number }>('account.move.reversal', 'refund_moves', { ids: [w], context: ctx });
    };
    const first = await reverse('2026-11-12');
    expect(first).toMatchObject({ res_model: 'account.move', res_id: expect.any(Number) });
    const [rev] = await call<Array<Record<string, unknown>>>('account.move', 'read', { ids: [first.res_id], fields: ['state', 'date', 'reversed_entry_id', 'move_type', 'ref'] });
    expect(rev).toMatchObject({ state: 'posted', date: '2026-11-12', reversed_entry_id: orig, move_type: 'entry' });
    expect(String(rev.ref)).toContain('wrong account');
    expect(await call('account.move.line', 'search_read', { domain: [['move_id', '=', first.res_id]], fields: ['account_id', 'debit', 'credit'] }))
      .toEqual([{ id: expect.any(Number), account_id: 601, debit: 0, credit: 100 }, { id: expect.any(Number), account_id: 101, debit: 100, credit: 0 }]);
    const second = await reverse('2026-12-31');   // V-ACD2: Odoo does not refuse a second reversal of the same move
    expect(second.res_id).not.toBe(first.res_id);
    expect((await call<Array<{ reversal_move_ids: number[] }>>('account.move', 'read', { ids: [orig], fields: ['reversal_move_ids'] }))[0].reversal_move_ids).toEqual([first.res_id, second.res_id]);
    // dated after today, the reversal waits as a draft until its day (auto-post at date)
    expect((await call<Array<{ state: string }>>('account.move', 'read', { ids: [second.res_id], fields: ['state'] }))[0].state).toBe('draft');
    expect(fake.rows('account.move').find((m) => m.id === orig)?.state).toBe('posted');
  });
});
