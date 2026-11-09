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
  describe('labour models (bed claims V-OLH-1, -4, -5, -7, -9, -11)', () => {
    const ENTRY = {
      move_type: 'entry', journal_id: 9, date: '2026-10-31', ref: 'PMO labour 2026-10', company_id: 1,
      line_ids: [
        [0, 0, { account_id: 41, name: 'Labour · P-1', debit: '1000000.00', credit: '0.00', analytic_distribution: { '77': 100 } }],
        [0, 0, { account_id: 42, name: 'Payroll payable', debit: '0.00', credit: '1000000.00' }],
      ],
    };
    const withEmployee = (extra: Record<string, unknown> = {}) => ({ vals_list: [{ project_id: 7, employee_id: 3, date: '2026-11-02', unit_amount: 4, name: 'TS 2026-W45 · 2026-11-02', company_id: 1, ...extra }] });

    it('AC-OLH-020 answers fields_get and has_access for every labour model', async () => {
      const { call } = setup();
      for (const model of ['hr.employee', 'account.analytic.line', 'account.move', 'account.move.line']) {
        expect(Object.keys(await call<Record<string, unknown>>(model, 'fields_get', {})), model).toContain('write_date');
        expect(await call(model, 'has_access', { operation: 'create' }), model).toBe(true);
      }
      const lineFields = Object.keys(await call<Record<string, unknown>>('account.analytic.line', 'fields_get', {}));
      for (const field of ['date', 'unit_amount', 'amount', 'project_id', 'employee_id', 'account_id', 'company_id']) expect(lineFields, field).toContain(field);
    });

    it('V-OLH-1 an analytic line without an employee is refused the way the bed refuses it, and one with an employee is created', async () => {
      const { fake, call } = setup();
      fake.seed('hr.employee', [{ id: 3, name: 'Example One', work_email: 'one@example.com', active: true, write_date: '2026-11-01 00:00:00' }]);
      const { vals_list } = withEmployee();
      const { employee_id: _omit, ...withoutEmployee } = vals_list[0];
      await expect(call('account.analytic.line', 'create', { vals_list: [withoutEmployee] })).rejects.toMatchObject({ errorClass: 'validation' });
      expect(fake.rows('account.analytic.line')).toEqual([]);
      const [id] = await call<number[]>('account.analytic.line', 'create', withEmployee());
      expect(fake.rows('account.analytic.line')).toMatchObject([{ id, employee_id: 3, unit_amount: 4 }]);
    });

    it('V-OLH-4/-5 a create with amount stores it verbatim, and a later employee-rate write changes nothing', async () => {
      const { fake, call } = setup();
      fake.seed('hr.employee', [{ id: 3, name: 'Example One', active: true }]);
      await call('account.analytic.line', 'create', withEmployee({ amount: 0 }));
      expect(fake.rows('account.analytic.line')[0].amount).toBe(0);
      const before = fake.rows('hr.employee')[0].write_date as string;
      await call('hr.employee', 'write', { ids: [3], vals: { hourly_cost: 250000 } });
      expect(fake.rows('account.analytic.line')[0].amount).toBe(0);
      expect((fake.rows('hr.employee')[0].write_date as string) > before).toBe(true);
    });

    it('V-OLH-7 posting an entry posts it and generates one analytic line per distribution at the negative of the balance', async () => {
      const { fake, call } = setup();
      const [moveId] = await call<number[]>('account.move', 'create', { vals_list: [ENTRY] });
      expect(fake.rows('account.move')[0]).toMatchObject({ state: 'draft', move_type: 'entry', journal_id: 9 });
      await call('account.move', 'action_post', { ids: [moveId] });
      const move = fake.rows('account.move')[0];
      expect(move.state).toBe('posted');
      expect(move.name).not.toBe(false);
      expect(fake.rows('account.move.line')).toMatchObject([
        { move_id: moveId, account_id: 41, debit: 1000000, credit: 0, parent_state: 'posted' },
        { move_id: moveId, account_id: 42, debit: 0, credit: 1000000, parent_state: 'posted' },
      ]);
      // V-ODA2 verified: amount is the negative of the line's balance, and a generated line's account_id reads false on v20.
      expect(fake.rows('account.analytic.line')).toMatchObject([{ account_id: false, amount: -1000000, date: '2026-10-31' }]);
    });

    it('V-OLH-8 a distribution split across two analytic accounts generates one analytic line per split share', async () => {
      const { fake, call } = setup();
      const [moveId] = await call<number[]>('account.move', 'create', { vals_list: [{ ...ENTRY, line_ids: [[0, 0, { account_id: 41, name: 'Labour · P-1', debit: '1000000.00', credit: '0.00', analytic_distribution: { '77': 60, '78': 40 } }], [0, 0, { account_id: 42, name: 'Payroll payable', debit: '0.00', credit: '1000000.00' }]] }] });
      await call('account.move', 'action_post', { ids: [moveId] });
      expect(fake.rows('account.analytic.line')).toMatchObject([{ amount: -600000 }, { amount: -400000 }]);
    });

    it('V-OLH-7 a credit-side expense line reverses in the analytic ledger, so a downward revision posts its own line', async () => {
      const { fake, call } = setup();
      const [moveId] = await call<number[]>('account.move', 'create', { vals_list: [{ ...ENTRY, line_ids: [
        [0, 0, { account_id: 41, name: 'Labour · P-2', debit: '0.00', credit: '1000.00', analytic_distribution: { '78': 100 } }],
        [0, 0, { account_id: 42, name: 'Payroll payable', debit: '1000.00', credit: '0.00' }],
      ] }] });
      await call('account.move', 'action_post', { ids: [moveId] });
      expect(fake.rows('account.move')[0].state).toBe('posted');
      expect(fake.rows('account.analytic.line')).toMatchObject([{ account_id: false, amount: 1000 }]);
    });

    it('V-ODA2 the split rounds each share and gives the last the remainder, so the amounts sum to the balance exactly', async () => {
      const { fake, call } = setup();
      const entry = (debit: string, distribution: Record<string, number>) => ({
        ...ENTRY,
        line_ids: [[0, 0, { account_id: 41, name: 'Labour · P-1', debit, credit: '0.00', analytic_distribution: distribution }]],
      });
      const [odd] = await call<number[]>('account.move', 'create', { vals_list: [entry('100.01', { '77': 60, '78': 40 })] });
      const [even] = await call<number[]>('account.move', 'create', { vals_list: [entry('0.05', { '77': 50, '78': 50 })] });
      await call('account.move', 'action_post', { ids: [odd, even] });
      expect(fake.rows('account.analytic.line').map((l) => l.amount)).toEqual([-60.01, -40, -0.03, -0.02]);
    });

    it('V-OLH-9 a posted move refuses a write to its lines or amounts, while ref and narration stay writable', async () => {
      const { fake, call } = setup();
      const [moveId] = await call<number[]>('account.move', 'create', { vals_list: [ENTRY] });
      await call('account.move', 'action_post', { ids: [moveId] });
      await expect(call('account.move', 'write', { ids: [moveId], vals: { line_ids: [] } })).rejects.toMatchObject({ errorClass: 'validation' });
      expect(fake.rows('account.move.line')).toHaveLength(2);
      // V-OPP2 verified a second user saving a posted bill's narration: ref and narration are not locked.
      await call('account.move', 'write', { ids: [moveId], vals: { ref: 'again', narration: 'why the correction' } });
      expect(fake.rows('account.move')[0]).toMatchObject({ ref: 'again', narration: 'why the correction' });
    });

    it('V-OPP2 a posted invoice still accepts a narration write', async () => {
      const { fake, call } = setup();
      const [id] = await call<number[]>('account.move', 'create', { vals_list: [{ move_type: 'out_invoice', partner_id: 5, invoice_line_ids: [[0, 0, { name: 'Progress claim', quantity: 1, price_unit: 10 }]] }] });
      await call('account.move', 'action_post', { ids: [id] });
      await call('account.move', 'write', { ids: [id], vals: { narration: 'posted note' } });
      expect(fake.rows('account.move')[0]).toMatchObject({ state: 'posted', narration: 'posted note' });
    });

    it('V-ODA1 a draft entry reads name false and move_name false; posting numbers it from the journal code and the entry year', async () => {
      const { fake, call } = setup();
      fake.seed('account.journal', [{ id: 9, code: 'MISC', name: 'Miscellaneous Operations' }]);
      const [moveId] = await call<number[]>('account.move', 'create', { vals_list: [{ ...ENTRY, date: '2025-12-31' }] });
      expect(fake.rows('account.move')[0].name).toBe(false);
      expect(fake.rows('account.move.line')[0].move_name).toBe(false);
      await call('account.move', 'action_post', { ids: [moveId] });
      expect(fake.rows('account.move')[0].name).toBe('MISC/2025/00001');
      expect(fake.rows('account.move.line')[0].move_name).toBe('MISC/2025/00001');
    });

    it('V-OLH-11 deleting an analytic line removes it and leaves no tombstone anywhere', async () => {
      const { fake, call } = setup();
      fake.seed('hr.employee', [{ id: 3, name: 'Example One', active: true }]);
      const [id] = await call<number[]>('account.analytic.line', 'create', withEmployee());
      await call('account.analytic.line', 'unlink', { ids: [id] });
      expect(fake.rows('account.analytic.line')).toEqual([]);
      expect(fake.rows('ir.model.data')).toEqual([]);
    });
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
