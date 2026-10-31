import { describe, expect, it } from 'vitest';
import { bindCall } from './client.ts';
import { createFakeOdoo } from './fakeOdoo.ts';
import { KIND_SPECS, type DirectoryRow } from './kinds.ts';
import {
  CENSUS_EVERY_MS, formatCursor, keysetDomain, odooKindReaders, overlapStart, PAGE_SIZE, parseCursor, runCensus, runKind,
  type KindRunDeps,
} from './sweep.ts';

const spec = KIND_SPECS.product;
const W = '2026-10-31 10:00:00';

/** apply_odoo_master_page's contract in memory: upsert never older over newer, then the cursor, in one step. */
function memoryStore() {
  const rows = new Map<string, DirectoryRow & { tombstoned?: boolean; seen?: string }>();
  const store = {
    cursor: '',
    rows,
    applies: [] as string[][],
    failNextApply: false,
    async apply(page: DirectoryRow[], cursor: string) {
      if (store.failNextApply) { store.failNextApply = false; throw new Error('apply failed'); }
      store.applies.push(page.map((r) => r.external_id));
      for (const r of page) { const old = rows.get(r.external_id); if (!old || old.source_write_date <= r.source_write_date) rows.set(r.external_id, { ...r }); }
      store.cursor = cursor;
    },
    async censusSeen(run: string, ids: string[]) { for (const id of ids) { const r = rows.get(id); if (r) { r.seen = run; r.tombstoned = false; } } },
    async censusFinish(run: string, cursor: string) { for (const r of rows.values()) if (!r.seen || r.seen < run) r.tombstoned = true; store.cursor = cursor; },
    snapshot: () => [...rows.values()].map(({ external_id, name, active, source_write_date }) => ({ external_id, name, active, source_write_date })).sort((a, b) => Number(a.external_id) - Number(b.external_id)),
  };
  return store;
}

function setup(opts: { pages?: number; pageSize?: number; censusPageSize?: number; now?: () => Date } = {}) {
  const fake = createFakeOdoo({ key: 'k' });
  const store = memoryStore();
  const call = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', fetchImpl: fake.fetch });
  let allowance = Infinity;
  const deps = (): KindRunDeps => ({
    ...odooKindReaders(call, spec, 1),
    apply: store.apply, censusSeen: store.censusSeen, censusFinish: store.censusFinish,
    budget: { spend: () => allowance-- > 0 },
    now: opts.now ?? (() => new Date('2026-10-31T12:00:00Z')),
    pageSize: opts.pageSize, censusPageSize: opts.censusPageSize,
  });
  const run = async (calls = Infinity) => { allowance = calls; return runKind(spec, store.cursor, deps()); };
  const census = async (calls = Infinity) => { allowance = calls; return runCensus(store.cursor, deps()); };
  return { fake, store, run, census };
}

const product = (id: number, write_date = W, extra: Record<string, unknown> = {}) => ({ id, name: `P${id}`, default_code: `C${id}`, write_date, company_id: false, ...extra });

describe('odoo/sweep cursor — AC-ODC-021', () => {
  it('parses an empty or broken cursor as a fresh one and round-trips a real one', () => {
    expect(parseCursor('')).toEqual({ w: null, id: 0, scan: null });
    expect(parseCursor('{not json')).toEqual({ w: null, id: 0, scan: null });
    const c = { w: W, id: 9, scan: null, census_done_at: '2026-10-31T00:00:00.000Z' };
    expect(parseCursor(formatCursor(c))).toEqual(c);
  });

  it('starts the feed ten minutes before the cursor, from id 0', () => {
    expect(overlapStart({ w: '2026-10-31 10:10:00', id: 9 })).toEqual({ w: '2026-10-31 10:00:00', id: 0 });
    expect(overlapStart({ w: '2026-11-01 00:05:00', id: 1 })).toEqual({ w: '2026-10-31 23:55:00', id: 0 });
  });

  it('reads strictly after (write_date, id), never write_date alone', () => {
    expect(keysetDomain({ w: W, id: 4 })).toEqual(['|', ['write_date', '>', W], '&', ['write_date', '=', W], ['id', '>', 4]]);
  });

  it('AC-ODC-021 five rows sharing one write_date at page size 2 are each applied once', async () => {
    const s = setup({ pageSize: 2 });
    s.store.cursor = formatCursor({ w: '2026-10-31 09:59:00', id: 0, scan: null });
    s.fake.seed('product.product', [1, 2, 3, 4, 5].map((id) => product(id)));
    const r = await s.run();
    expect(r.done).toBe(true);
    expect(r.applied.map((x) => x.external_id)).toEqual(['1', '2', '3', '4', '5']);
    expect(parseCursor(s.store.cursor)).toMatchObject({ w: W, id: 5 });
  });

  it('AC-ODC-021 a row committed late with an earlier write_date than the cursor is picked up inside the overlap', async () => {
    const s = setup();
    s.store.cursor = formatCursor({ w: '2026-10-31 09:00:00', id: 0, scan: null });
    s.fake.seed('product.product', [product(1)]);
    await s.run();
    s.fake.seed('product.product', [product(2, '2026-10-31 09:58:00')]);
    const r = await s.run();
    expect(r.applied.map((x) => x.external_id)).toContain('2');
    expect(parseCursor(s.store.cursor)).toMatchObject({ w: W, id: 1 }); // the late row never moves the cursor backwards
  });

  it('AC-ODC-021 a tick that ends inside the overlap never moves the cursor backwards', async () => {
    const s = setup({ pageSize: 1 });
    s.store.cursor = formatCursor({ w: W, id: 1, scan: null });
    s.fake.seed('product.product', [product(1), product(2, '2026-10-31 09:58:00')]);
    const r = await s.run(1);
    expect(r.applied.map((x) => x.external_id)).toEqual(['2']);
    expect(parseCursor(s.store.cursor)).toMatchObject({ w: W, id: 1 });
  });

  it('AC-ODC-021 an apply that throws leaves the stored cursor unchanged, and the re-run produces identical rows', async () => {
    const s = setup({ pageSize: 2 });
    s.fake.seed('product.product', [1, 2, 3, 4, 5].map((id) => product(id)));
    s.store.cursor = formatCursor({ w: '2026-10-31 09:59:00', id: 0, scan: null });
    const before = s.store.cursor;
    s.store.failNextApply = true;
    await expect(s.run()).rejects.toThrow('apply failed');
    expect(s.store.cursor).toBe(before);
    await s.run();
    const once = s.store.snapshot();
    await s.run();
    expect(s.store.snapshot()).toEqual(once);
    expect(once).toHaveLength(5);
  });

  it('reads archived rows and only the activated company\'s rows plus shared ones', async () => {
    const s = setup();
    s.fake.seed('product.product', [product(1, W, { active: false }), product(2, W, { company_id: [1, 'Main'] }), product(3, W, { company_id: [2, 'Other'] })]);
    await s.run();
    expect(s.store.snapshot().map((r) => [r.external_id, r.active])).toEqual([['1', false], ['2', true]]);
  });

  it('skips and counts a malformed row, applying the rest of its page', async () => {
    const s = setup();
    s.store.cursor = formatCursor({ w: '2026-10-31 09:59:00', id: 0, scan: null });
    s.fake.seed('product.product', [product(1), product(2, W, { name: false })]);
    const r = await s.run();
    expect(r.skipped).toBe(1);
    expect(s.store.snapshot().map((x) => x.external_id)).toEqual(['1']);
  });
});

describe('odoo/sweep initial scan — AC-ODC-022, AC-ODC-026', () => {
  const seedSeven = (s: ReturnType<typeof setup>) =>
    s.fake.seed('product.product', Array.from({ length: PAGE_SIZE * 6 + 50 }, (_, i) => product(i + 1, `2026-10-${String(1 + (i % 28)).padStart(2, '0')} 08:00:00`)));

  it('AC-ODC-022 a 7-page scan at 3 pages per tick resumes from recorded progress and ends like an unbounded run', async () => {
    const bounded = setup();
    seedSeven(bounded);
    const t1 = await bounded.run(3);
    expect(t1.done).toBe(false);
    expect(parseCursor(bounded.store.cursor).scan?.after_id).toBe(PAGE_SIZE * 3);
    await bounded.run(3);
    expect(parseCursor(bounded.store.cursor).scan?.after_id).toBeGreaterThan(0);
    const t3 = await bounded.run(3);
    expect(t3.done).toBe(true);
    expect(parseCursor(bounded.store.cursor)).toMatchObject({ scan: null, w: '2026-10-31 11:50:00' });

    const unbounded = setup();
    seedSeven(unbounded);
    await unbounded.run();
    expect(bounded.store.snapshot()).toEqual(unbounded.store.snapshot());
    expect(bounded.store.snapshot()).toHaveLength(PAGE_SIZE * 6 + 50);
  });

  it('AC-ODC-026 after a reset (an empty cursor) the re-run applies the same row set', async () => {
    const s = setup();
    seedSeven(s);
    await s.run();
    const first = s.store.snapshot();
    s.store.cursor = '';
    s.store.applies.length = 0;
    await s.run();
    expect(s.store.applies.flat()).toHaveLength(first.length);
    expect(s.store.snapshot()).toEqual(first);
  });
});

describe('odoo/sweep census — AC-ODC-023 logic', () => {
  it('tombstones an id Odoo no longer has, keeps archived rows, and writes census_done_at with the finish', async () => {
    const s = setup({ censusPageSize: 2 });
    s.fake.seed('product.product', [product(1), product(2, W, { active: false }), product(3), product(4)]);
    await s.run();
    await s.fake.fetch('https://odoo.example.test/json/2/product.product/unlink', { method: 'POST', headers: { Authorization: 'bearer k' }, body: JSON.stringify({ ids: [3] }) });
    expect(await s.census()).toBe(true);
    expect([...s.store.rows.values()].filter((r) => r.tombstoned).map((r) => r.external_id)).toEqual(['3']);
    expect(parseCursor(s.store.cursor).census_done_at).toBe('2026-10-31T12:00:00.000Z');
  });

  it('does not run again within a day, and runs once a day has passed', async () => {
    let now = new Date('2026-10-31T12:00:00Z');
    const s = setup({ now: () => now });
    s.fake.seed('product.product', [product(1)]);
    await s.run();
    await s.census();
    const calls = s.fake.calls.length;
    now = new Date(now.getTime() + CENSUS_EVERY_MS - 1);
    expect(await s.census()).toBe(true);
    expect(s.fake.calls.length).toBe(calls);
    now = new Date(now.getTime() + 2);
    await s.census();
    expect(s.fake.calls.length).toBe(calls + 1);
  });

  it('a census cut short by the budget tombstones nothing', async () => {
    const s = setup({ censusPageSize: 2 });
    s.fake.seed('product.product', [product(1), product(2), product(3), product(4), product(5)]);
    await s.run();
    await s.fake.fetch('https://odoo.example.test/json/2/product.product/unlink', { method: 'POST', headers: { Authorization: 'bearer k' }, body: JSON.stringify({ ids: [5] }) });
    expect(await s.census(2)).toBe(false);
    expect([...s.store.rows.values()].some((r) => r.tombstoned)).toBe(false);
    expect(parseCursor(s.store.cursor).census_done_at).toBeUndefined();
  });
});
