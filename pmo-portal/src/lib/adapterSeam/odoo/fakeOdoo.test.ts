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
});
