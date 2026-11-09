import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Contacts directory is read as ONE SERVER page + exact total (issue #1989, the Master-data
 * pattern): the company filter and the name/email search are applied on the SERVER *before* the
 * range, and the order is TOTAL (full_name, then id) so an OFFSET page can neither repeat nor
 * skip a contact.
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

import { countContacts, listContacts, listContactsPage } from './contacts';
import { AppError } from '@/src/lib/appError';

beforeEach(() => h.reset());

describe('listContactsPage (server directory page, #1989)', () => {
  it('reads a page with an exact count, hides archived, TOTAL order, page 1 window', async () => {
    h.setResult({ data: [{ id: 'ct1', full_name: 'Jane Doe' }], error: null, count: 15 });
    const page = await listContactsPage({ page: 1, pageSize: 50 });
    expect(h.calls.from).toEqual(['contacts']);
    expect(h.calls.select[0][0]).toBe('*');
    expect(h.calls.select[0][1]).toMatchObject({ count: 'exact' });
    expect(h.calls.is).toEqual([['archived_at', null]]);
    expect(h.calls.eq).toEqual([]);
    expect(h.calls.or).toEqual([]);
    expect(h.calls.order).toEqual([['full_name'], ['id']]);
    expect(h.calls.range).toEqual([[0, 49]]);
    expect(page).toEqual({ rows: [{ id: 'ct1', full_name: 'Jane Doe' }], total: 15 });
  });

  it('windows later pages by OFFSET: page 3 of 25 is [50, 74]', async () => {
    h.setResult({ data: [], error: null, count: 60 });
    await listContactsPage({ page: 3, pageSize: 25 });
    expect(h.calls.range).toEqual([[50, 74]]);
  });

  it('applies the company filter server-side, before the range', async () => {
    h.setResult({ data: [], error: null, count: 3 });
    await listContactsPage({ page: 1, pageSize: 50, companyId: 'c-2' });
    expect(h.calls.eq).toEqual([['company_id', 'c-2']]);
    expect(h.calls.range).toEqual([[0, 49]]);
  });

  it('searches full_name AND email server-side as escaped ilike patterns', async () => {
    h.setResult({ data: [], error: null, count: 1 });
    await listContactsPage({ page: 1, pageSize: 50, search: 'pri' });
    expect(h.calls.or).toHaveLength(1);
    expect(h.calls.or[0]).toContain('full_name.ilike.');
    expect(h.calls.or[0]).toContain('email.ilike.');
    expect(h.calls.or[0]).toMatch(/"%pri%"/);
  });

  it('a missing exact count is an error, never a verified-looking empty directory', async () => {
    h.setResult({ data: [{ id: 'ct1' }], error: null, count: null });
    await expect(listContactsPage({ page: 1, pageSize: 50 })).rejects.toMatchObject({ code: 'COUNT_UNRESOLVED' });
  });

  it('a page error throws with the code preserved', async () => {
    h.setResult({ data: null, error: { message: 'RLS rejected', code: '42501' } });
    await expect(listContactsPage({ page: 1, pageSize: 50 })).rejects.toSatisfy((e: unknown) => {
      const err = e as { code?: string; message: string };
      return err instanceof AppError && err.code === '42501' && err.message === 'RLS rejected';
    });
  });
});

describe('countContacts (the "of Y" behind a filtered "Showing X of Y")', () => {
  it('is a head count of the non-archived directory — no body bytes', async () => {
    h.setResult({ data: null, error: null, count: 15 });
    await expect(countContacts()).resolves.toBe(15);
    expect(h.calls.select[0]).toEqual(['id', { count: 'exact', head: true }]);
    expect(h.calls.is).toEqual([['archived_at', null]]);
  });

  it('a failed count throws', async () => {
    h.setResult({ data: null, error: { message: 'boom', code: 'XX000' } });
    await expect(countContacts()).rejects.toBeInstanceOf(AppError);
  });
});

describe('listContacts export extension (#1989)', () => {
  it('without params the keyset read is unchanged', async () => {
    h.pushResult({ data: [{ id: 'ct1', full_name: 'Jane' }], error: null, count: null });
    await listContacts();
    expect(h.calls.or).toEqual([]);
    expect(h.calls.eq).toEqual([]);
  });

  it('company filter and search are applied SERVER-side inside the keyset read', async () => {
    h.pushResult({ data: [{ id: 'ct1', full_name: 'Jane Harlow' }], error: null, count: null });
    const rows = await listContacts({ companyId: 'c-1', search: 'har' });
    expect(h.calls.eq).toEqual([['company_id', 'c-1']]);
    expect(h.calls.or).toHaveLength(1);
    expect(h.calls.or[0]).toContain('full_name.ilike.');
    expect(rows.map((r) => (r as { full_name: string }).full_name)).toEqual(['Jane Harlow']);
  });
});

describe('listContactsPage past the last page (#1989 review)', () => {
  it('PostgREST answers an out-of-range OFFSET with PGRST103; that is an EMPTY page with the real total, not an error', async () => {
    h.pushResult({ data: null, error: { code: 'PGRST103', message: 'Requested range not satisfiable' }, count: null });
    h.pushResult({ data: null, error: null, count: 51 });
    const page = await listContactsPage({ page: 3, pageSize: 50, companyId: 'co1', search: 'ja' });
    expect(page).toEqual({ rows: [], total: 51 });
    expect(h.calls.eq).toEqual([['company_id', 'co1'], ['company_id', 'co1']]);
    expect(h.calls.or).toHaveLength(2);
  });

  it('other page errors still throw', async () => {
    h.pushResult({ data: null, error: { code: '42501', message: 'denied' }, count: null });
    await expect(listContactsPage({ page: 1, pageSize: 50 })).rejects.toBeInstanceOf(AppError);
  });
});
