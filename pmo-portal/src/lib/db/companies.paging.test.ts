import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Companies directory is read as ONE SERVER page + exact total (issue #1989, the Master-data
 * pattern): the type filter and search are applied on the SERVER *before* the range, the read is
 * an explicit directory projection (never `select *` — the wide row WAS the response cost), and
 * the order is TOTAL (name, then id) so an OFFSET page can neither repeat nor skip a company.
 */
const h = vi.hoisted(() => {
  const calls = {
    from: [] as string[],
    select: [] as unknown[][],
    eq: [] as unknown[][],
    is: [] as unknown[][],
    or: [] as string[],
    order: [] as unknown[][],
    range: [] as number[][],
    gt: [] as unknown[][],
    limit: [] as unknown[],
  };
  let result: { data: unknown; error: unknown; count?: number | null } = { data: [], error: null, count: 0 };
  const queue: Array<{ data: unknown; error: unknown; count?: number | null }> = [];
  const next = () => (queue.length ? queue.shift()! : result);
  const from = vi.fn((table: string) => {
    calls.from.push(table);
    const q: Record<string, unknown> = {};
    q.select = (...args: unknown[]) => { calls.select.push(args); return q; };
    q.eq = (...args: unknown[]) => { calls.eq.push(args); return q; };
    q.is = (...args: unknown[]) => { calls.is.push(args); return q; };
    q.or = (filter: string) => { calls.or.push(filter); return q; };
    q.order = (...args: unknown[]) => { calls.order.push(args); return q; };
    q.range = (a: number, b: number) => { calls.range.push([a, b]); return q; };
    q.gt = (...args: unknown[]) => { calls.gt.push(args); return q; };
    q.limit = (n: unknown) => { calls.limit.push(n); return q; };
    q.then = (resolve: (value: unknown) => unknown) => resolve(next());
    return q;
  });
  return {
    from,
    calls,
    setResult: (r: typeof result) => { result = r; },
    pushResult: (r: typeof result) => { queue.push(r); },
    reset: () => {
      from.mockClear();
      calls.from.length = 0;
      calls.select.length = 0;
      calls.eq.length = 0;
      calls.is.length = 0;
      calls.or.length = 0;
      calls.order.length = 0;
      calls.range.length = 0;
      calls.gt.length = 0;
      calls.limit.length = 0;
      queue.length = 0;
      result = { data: [], error: null, count: 0 };
    },
  };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import {
  countCompanies,
  listCompanies,
  listCompaniesPage,
  listCompanyOptions,
} from './companies';
import { AppError } from '@/src/lib/appError';

beforeEach(() => h.reset());

describe('listCompaniesPage (server directory page, #1989)', () => {
  it('reads the directory projection with an exact count, hides archived, and windows page 1', async () => {
    h.setResult({ data: [{ id: 'c1', name: 'Atlas', short_name: null, type: 'Client', client_number_segment: null }], error: null, count: 21 });
    const page = await listCompaniesPage({ page: 1, pageSize: 50 });
    expect(h.calls.from).toEqual(['companies']);
    // Explicit projection, never select(*): the wide row is the directory's response cost.
    expect(h.calls.select[0][0]).toBe('id,name,short_name,type,client_number_segment');
    expect(h.calls.select[0][1]).toMatchObject({ count: 'exact' });
    expect(h.calls.is).toEqual([['archived_at', null]]);
    expect(h.calls.eq).toEqual([]);
    expect(h.calls.or).toEqual([]);
    // TOTAL order: name then id — equal names cannot shuffle rows across page boundaries.
    expect(h.calls.order).toEqual([['name'], ['id']]);
    expect(h.calls.range).toEqual([[0, 49]]);
    expect(page).toEqual({ rows: [{ id: 'c1', name: 'Atlas', short_name: null, type: 'Client', client_number_segment: null }], total: 21 });
  });

  it('windows later pages by OFFSET: page 2 of 50 is [50, 99]', async () => {
    h.setResult({ data: [], error: null, count: 120 });
    await listCompaniesPage({ page: 2, pageSize: 50 });
    expect(h.calls.range).toEqual([[50, 99]]);
  });

  it('applies the type filter server-side, before the range', async () => {
    h.setResult({ data: [], error: null, count: 4 });
    await listCompaniesPage({ page: 1, pageSize: 50, type: 'Vendor' });
    expect(h.calls.eq).toEqual([['type', 'Vendor']]);
    expect(h.calls.range).toEqual([[0, 49]]);
  });

  it('searches name AND short_name server-side as a quoted, wildcard-escaped ilike', async () => {
    h.setResult({ data: [], error: null, count: 2 });
    await listCompaniesPage({ page: 1, pageSize: 50, search: 'steel' });
    expect(h.calls.or).toHaveLength(1);
    const filter = h.calls.or[0];
    expect(filter).toContain('name.ilike.');
    expect(filter).toContain('short_name.ilike.');
    // the term is wrapped as a contains-pattern
    expect(filter).toMatch(/"%steel%"/);
  });

  it('escapes LIKE wildcards in the search term', async () => {
    h.setResult({ data: [], error: null, count: 0 });
    await listCompaniesPage({ page: 1, pageSize: 50, search: '50%' });
    expect(h.calls.or[0]).toContain('50\\%%');
  });

  it('ignores a blank search (whitespace-only is not a filter)', async () => {
    h.setResult({ data: [], error: null, count: 21 });
    await listCompaniesPage({ page: 1, pageSize: 50, search: '   ' });
    expect(h.calls.or).toEqual([]);
  });

  it('a missing exact count is an error, never a verified-looking empty directory', async () => {
    h.setResult({ data: [{ id: 'c1' }], error: null, count: null });
    await expect(listCompaniesPage({ page: 1, pageSize: 50 })).rejects.toMatchObject({ code: 'COUNT_UNRESOLVED' });
  });

  it('a page error throws with the code preserved — a failed page is never an empty one', async () => {
    h.setResult({ data: null, error: { message: 'RLS rejected', code: '42501' } });
    await expect(listCompaniesPage({ page: 1, pageSize: 50 })).rejects.toSatisfy((e: unknown) => {
      const err = e as { code?: string; message: string };
      return err instanceof AppError && err.code === '42501' && err.message === 'RLS rejected';
    });
  });
});

describe('countCompanies (the "of Y" behind a filtered "Showing X of Y")', () => {
  it('is a head count of the non-archived directory — no body bytes', async () => {
    h.setResult({ data: null, error: null, count: 21 });
    await expect(countCompanies()).resolves.toBe(21);
    expect(h.calls.select[0]).toEqual(['id', { count: 'exact', head: true }]);
    expect(h.calls.is).toEqual([['archived_at', null]]);
  });

  it('a failed count throws', async () => {
    h.setResult({ data: null, error: { message: 'boom', code: 'XX000' } });
    await expect(countCompanies()).rejects.toBeInstanceOf(AppError);
  });
});

describe('listCompanyOptions (the pickers that must offer EVERY company)', () => {
  it('reads only the display fields across EVERY keyset page, archived hidden, name-sorted', async () => {
    // Page 1 must be FULL (the scan stops on a short page) to prove the second page is read.
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({ id: `k${String(i).padStart(4, '0')}`, name: `N${i}`, short_name: null }));
    h.pushResult({ data: fullPage, error: null, count: null });
    h.pushResult({ data: [{ id: 'a-early', name: 'Alpha', short_name: 'AL' }], error: null, count: null });
    const rows = await listCompanyOptions();
    expect(h.calls.select[0][0]).toBe('id,name,short_name');
    // one read per keyset page; EVERY page re-applies the archived filter
    expect(h.calls.is).toEqual([['archived_at', null], ['archived_at', null]]);
    expect(h.calls.limit).toEqual([1000, 1000]);
    // the cursor resumes AFTER the last row of page 1
    expect(h.calls.gt).toEqual([['id', 'k0999']]);
    // the name-ordered contract is restored in memory over the COMPLETE set
    expect(rows[0].name).toBe('Alpha');
    expect(rows).toHaveLength(1001);
  });

  it('a page error throws', async () => {
    h.setResult({ data: null, error: { message: 'boom', code: 'XX000' } });
    await expect(listCompanyOptions()).rejects.toBeInstanceOf(AppError);
  });
});

describe('listCompanies export extension (#1989)', () => {
  it('without a search the keyset read is unchanged (no or() filter)', async () => {
    h.pushResult({ data: [{ id: 'c1', name: 'Atlas' }], error: null, count: null });
    await listCompanies();
    expect(h.calls.or).toEqual([]);
    expect(h.calls.eq).toEqual([]);
  });

  it('with a search the term is applied SERVER-side inside the keyset read', async () => {
    h.pushResult({ data: [{ id: 'c1', name: 'Steelworks' }], error: null, count: null });
    const rows = await listCompanies({ type: 'Client', search: 'steel' });
    expect(h.calls.eq).toEqual([['type', 'Client']]);
    expect(h.calls.or).toHaveLength(1);
    expect(h.calls.or[0]).toContain('name.ilike.');
    expect(rows.map((r) => (r as { name: string }).name)).toEqual(['Steelworks']);
  });
});
