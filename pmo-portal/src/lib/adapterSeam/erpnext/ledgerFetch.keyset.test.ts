/**
 * THEME-DATA-03 (ADP-016/018): the ledger scan pages a live, mutable list with a composite
 * (modified, name) keyset, never an offset, and persists the composite cursor so a tie group larger
 * than a whole tick's page budget still drains across ticks.
 *
 * The fake ERP below evaluates the real filter tuples (company / modified / name) + the stable order
 * + page length against a mutable table — so a protocol that skips or repeats rows fails here.
 */
import { describe, expect, it, vi } from 'vitest';
import { fetchGlEntries, fetchPaymentLedgerEntries, formatLedgerCursor } from './ledgerFetch.ts';
import type { ErpClientDeps } from './client.ts';

type Row = { name: string; account: string; modified: string; company: string; debit: string; credit: string };

function fakeErp(table: Row[]) {
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (url: string) => {
    urls.push(url);
    const q = new URL(url).searchParams;
    expect(Number(q.get('limit_start') ?? 0)).toBe(0); // keyset only: an offset is never sent
    const filters = JSON.parse(q.get('filters') ?? '[]') as Array<[string, string, string]>;
    const pass = (r: Row) => filters.every(([f, op, v]) => {
      const x = (r as unknown as Record<string, string>)[f];
      return op === '=' ? x === v : op === '>=' ? x >= v : op === '>' ? x > v : false;
    });
    const sorted = table.filter(pass).sort((a, b) => (a.modified === b.modified ? a.name.localeCompare(b.name) : a.modified.localeCompare(b.modified)));
    return new Response(JSON.stringify({ data: sorted.slice(0, Number(q.get('limit_page_length'))).map((r) => ({ ...r })) }), { status: 200 });
  });
  const client = { fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.com' } as ErpClientDeps;
  return { client, urls, table };
}

const ts = '2026-07-12 10:00:00.000000';
const mk = (name: string, modified = ts): Row => ({ name, account: 'A', modified, company: 'Co', debit: '1', credit: '0' });

describe('THEME-DATA-03 composite keyset ledger scan', () => {
  it('drains an equal-timestamp group larger than the whole per-tick budget across ticks, each row exactly once', async () => {
    const names = Array.from({ length: 11 }, (_, i) => `GLE-${String(i).padStart(3, '0')}`);
    const erp = fakeErp([...names.map((n) => mk(n)), mk('GLE-LATER', '2026-07-12 10:00:05.000000')]);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let tick = 0; tick < 10; tick += 1) {
      const r = await fetchGlEntries(erp.client, { company: 'Co', since: cursor, pageSize: 2, maxPages: 2 });
      seen.push(...r.rows.map((x) => x.name));
      if (r.cursor) cursor = r.cursor;
      if (r.caughtUp) break;
    }
    expect(seen).toEqual([...names, 'GLE-LATER']); // tie group (11 rows > 2 pages x 2 rows) fully drained, then the later row
  });

  it('an already-read row updated between pages is neither skipped around nor loses its neighbours', async () => {
    const erp = fakeErp([mk('A', '2026-07-12 10:00:01.000000'), mk('B', '2026-07-12 10:00:02.000000'), mk('C', '2026-07-12 10:00:03.000000'), mk('D', '2026-07-12 10:00:04.000000')]);
    const first = await fetchGlEntries(erp.client, { company: 'Co', pageSize: 2, maxPages: 1 });
    expect(first.rows.map((r) => r.name)).toEqual(['A', 'B']);
    // A (already read) is updated: it moves to the end of the modified order — an offset would now skip C.
    erp.table.find((r) => r.name === 'A')!.modified = '2026-07-12 10:00:09.000000';
    const second = await fetchGlEntries(erp.client, { company: 'Co', since: first.cursor!, pageSize: 2, maxPages: 5 });
    expect(second.rows.map((r) => r.name)).toEqual(['C', 'D', 'A']); // C is not skipped; the updated A is re-delivered
    expect(second.caughtUp).toBe(true);
  });

  it('the persisted cursor is the last row (modified + name) and sorts after a bare timestamp of the same instant', async () => {
    const erp = fakeErp([mk('X-1'), mk('X-2')]);
    const r = await fetchGlEntries(erp.client, { company: 'Co', pageSize: 5 });
    expect(r.cursor).toBe(formatLedgerCursor(ts, 'X-2'));
    expect(ts < r.cursor!).toBe(true); // string order used by the watermark's monotonic advance
  });

  it('a legacy bare-timestamp cursor reads inclusively from that instant (the boundary row is re-delivered)', async () => {
    const erp = fakeErp([mk('X-1'), mk('X-2', '2026-07-12 10:00:09.000000')]);
    const r = await fetchGlEntries(erp.client, { company: 'Co', since: ts, pageSize: 5 });
    expect(r.rows.map((x) => x.name)).toEqual(['X-1', 'X-2']);
  });

  it('with no rows the returned cursor is null so the caller keeps its watermark', async () => {
    const r = await fetchGlEntries(fakeErp([]).client, { company: 'Co', since: formatLedgerCursor(ts, 'Z') });
    expect(r).toMatchObject({ rows: [], caughtUp: true, cursor: null });
  });

  it('a malformed later page rejects instead of returning a prefix (the caller never advances)', async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => (n++ === 0
      ? new Response(JSON.stringify({ data: [mk('A'), mk('B')] }))
      : new Response('{"data":null}')));
    const client = { fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.com' } as ErpClientDeps;
    await expect(fetchGlEntries(client, { company: 'Co', pageSize: 2, maxPages: 3 })).rejects.toMatchObject({ code: 'external-unreachable' });
  });

  it('Payment Ledger Entry uses the same keyset protocol', async () => {
    const erp = fakeErp(Array.from({ length: 5 }, (_, i) => mk(`PLE-${i}`)));
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let tick = 0; tick < 6; tick += 1) {
      const r = await fetchPaymentLedgerEntries(erp.client, { company: 'Co', since: cursor, pageSize: 2, maxPages: 1 });
      seen.push(...r.rows.map((x) => x.name));
      if (r.cursor) cursor = r.cursor;
      if (r.caughtUp) break;
    }
    expect(seen).toEqual(['PLE-0', 'PLE-1', 'PLE-2', 'PLE-3', 'PLE-4']);
  });
});
