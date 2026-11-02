import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageResult } from '@/src/lib/pagedRead';

// DAL01-005 (THEME-DATA-22): PostgREST caps ONE response at db-max-rows (1000) and signals
// nothing when it truncates. The directory/comment/activity list contracts back completeness-
// dependent consumers (the directory index, FK pickers, export, a record's full discussion and
// activity timeline), so they must traverse EVERY keyset page instead of returning one capped
// response. These tests emulate the server cap: each response returns at most 1000 rows.
const h = vi.hoisted(() => {
  interface Query {
    table: string;
    columns: string;
    eq: Array<[string, unknown]>;
    memberships: Array<[string, unknown[]]>;
    is: Array<[string, unknown]>;
    order: Array<[string, { ascending?: boolean } | undefined]>;
    gt: Array<[string, string]>;
    limit: number | null;
  }
  const queries: Query[] = [];
  let rows: Array<Record<string, unknown>> = [];
  let error: { message: string; code?: string } | null = null;
  let errorQueryIndex = -1;
  const SERVER_MAX_ROWS = 1000;
  const from = vi.fn((table: string) => {
    const query: Query = { table, columns: '', eq: [], memberships: [], is: [], order: [], gt: [], limit: null };
    const index = queries.length;
    queries.push(query);
    const builder: Record<string, unknown> = {};
    builder.select = (columns: string) => { query.columns = columns; return builder; };
    builder.eq = (column: string, value: unknown) => { query.eq.push([column, value]); return builder; };
    builder.in = (column: string, values: unknown[]) => { query.memberships.push([column, values]); return builder; };
    builder.is = (column: string, value: unknown) => { query.is.push([column, value]); return builder; };
    builder.order = (column: string, options?: { ascending?: boolean }) => { query.order.push([column, options]); return builder; };
    builder.gt = (column: string, value: string) => { query.gt.push([column, value]); return builder; };
    builder.limit = (value: number) => { query.limit = value; return builder; };
    builder.then = (resolve: (value: unknown) => void) => {
      let selected = rows.filter((row) =>
        query.eq.every(([column, value]) => row[column] === value)
        && query.memberships.every(([column, values]) => values.includes(row[column]))
        && query.is.every(([column, value]) => row[column] === value),
      );
      for (const [column, options] of query.order) {
        selected = [...selected].sort((left, right) => {
          const direction = options?.ascending === false ? -1 : 1;
          return direction * String(left[column] ?? '').localeCompare(String(right[column] ?? ''));
        });
      }
      for (const [column, value] of query.gt) selected = selected.filter((row) => String(row[column] ?? '') > value);
      const failed = index === errorQueryIndex;
      const page: PageResult<Record<string, unknown>> = failed
        ? { data: null, error: error! }
        : { data: selected.slice(0, query.limit != null ? Math.min(query.limit, SERVER_MAX_ROWS) : SERVER_MAX_ROWS), error: null };
      return Promise.resolve(page).then(resolve);
    };
    return builder;
  });
  return {
    from,
    queries,
    setRows: (next: Array<Record<string, unknown>>) => { rows = next; },
    setError: (next: { message: string; code?: string } | null, queryIndex = -1) => { error = next; errorQueryIndex = queryIndex; },
    reset: () => { queries.length = 0; rows = []; error = null; errorQueryIndex = -1; from.mockClear(); },
  };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { listClientCompanies, listCompanies } from './companies';
import { listContacts, listContactsByCompany } from './contacts';
import { listComments } from './comments';
import { listActivities, listActivitiesForContacts } from './crmActivities';

beforeEach(() => h.reset());

describe('complete directory reads (DAL01-005)', () => {
  it('listCompanies traverses every keyset page and returns the full directory in name order', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({
      id: `c${String(i).padStart(4, '0')}`,
      name: `Company ${String(i).padStart(4, '0')}`,
      type: 'Client',
      archived_at: null,
    }));
    h.setRows(rows);
    const result = await listCompanies();
    expect(result).toHaveLength(1001);
    expect(result.map((r) => r.id)).toEqual(rows.map((r) => r.id));
    expect(h.queries).toHaveLength(2);
    expect(h.queries[0]).toMatchObject({ table: 'companies', order: [['id', { ascending: true }]], limit: 1000, gt: [], is: [['archived_at', null]] });
    expect(h.queries[1].gt).toEqual([['id', 'c0999']]);
  });

  it('listCompanies keeps the type filter on every page', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({
      id: `v${String(i).padStart(4, '0')}`,
      name: `Vendor ${String(i).padStart(4, '0')}`,
      type: i === 1000 ? 'Client' : 'Vendor',
      archived_at: null,
    }));
    h.setRows(rows);
    const result = await listCompanies({ type: 'Vendor' });
    expect(result).toHaveLength(1000);
    expect(h.queries).toHaveLength(2);
    expect(h.queries[0].eq).toEqual([['type', 'Vendor']]);
    expect(h.queries[1].eq).toEqual([['type', 'Vendor']]);
    expect(h.queries[1].gt).toEqual([['id', 'v0999']]);
  });

  it('listClientCompanies traverses pages and excludes archived rows on every page', async () => {
    const rows = Array.from({ length: 1100 }, (_, i) => ({
      id: `c${String(i).padStart(4, '0')}`,
      name: `Client ${String(i).padStart(4, '0')}`,
      type: 'Client',
      archived_at: i === 1000 ? '2026-01-01T00:00:00Z' : null,
    }));
    h.setRows(rows);
    const result = await listClientCompanies();
    expect(result).toHaveLength(1099);
    expect(result.every((r) => r.archived_at === null)).toBe(true);
    expect(result.some((r) => r.id === 'c1000')).toBe(false);
    expect(h.queries).toHaveLength(2);
    expect(h.queries[1].gt).toEqual([['id', 'c0999']]);
  });

  it('listContacts traverses every keyset page and returns the directory in full_name order', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({
      id: `p${String(i).padStart(4, '0')}`,
      full_name: `Person ${String(i).padStart(4, '0')}`,
      company_id: 'co1',
      archived_at: null,
    }));
    h.setRows(rows);
    const result = await listContacts();
    expect(result).toHaveLength(1001);
    expect(result.map((r) => r.id)).toEqual(rows.map((r) => r.id));
    expect(h.queries).toHaveLength(2);
    expect(h.queries[1].gt).toEqual([['id', 'p0999']]);
  });

  it('listContactsByCompany keeps the company filter on every page', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({
      id: `p${String(i).padStart(4, '0')}`,
      full_name: `Person ${String(i).padStart(4, '0')}`,
      company_id: i === 1000 ? 'other-co' : 'co1',
      archived_at: null,
    }));
    h.setRows(rows);
    const result = await listContactsByCompany('co1');
    expect(result).toHaveLength(1000);
    expect(h.queries).toHaveLength(2);
    expect(h.queries[0].eq).toEqual([['company_id', 'co1']]);
    expect(h.queries[1].gt).toEqual([['id', 'p0999']]);
  });

  it('listComments traverses every keyset page and returns the discussion oldest-first', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({
      id: `cm${String(i).padStart(4, '0')}`,
      entity_type: 'task',
      entity_id: 't1',
      archived_at: null,
      created_at: `2026-01-01T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z`,
      author: null,
    }));
    h.setRows(rows);
    const result = await listComments('task', 't1');
    expect(result).toHaveLength(1001);
    expect(result.map((r) => r.id)).toEqual(rows.map((r) => r.id));
    expect(h.queries).toHaveLength(2);
    expect(h.queries[0]).toMatchObject({ table: 'comments', order: [['id', { ascending: true }]], limit: 1000 });
    expect(h.queries[1].gt).toEqual([['id', 'cm0999']]);
  });

  it('listComments sorts ties by id so the order is total', async () => {
    h.setRows([
      { id: 'b', entity_type: 'task', entity_id: 't1', archived_at: null, created_at: '2026-01-01T00:00:00Z', author: null },
      { id: 'a', entity_type: 'task', entity_id: 't1', archived_at: null, created_at: '2026-01-01T00:00:00Z', author: null },
      { id: 'c', entity_type: 'task', entity_id: 't1', archived_at: null, created_at: '2026-01-01T00:00:01Z', author: null },
    ]);
    const result = await listComments('task', 't1');
    expect(result.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('listActivities traverses every keyset page and returns the timeline newest-first', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({
      id: `a${String(i).padStart(4, '0')}`,
      contact_id: 'ct1',
      occurred_at: `2026-01-01T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z`,
    }));
    h.setRows(rows);
    const result = await listActivities('ct1');
    expect(result).toHaveLength(1001);
    expect(result.map((r) => r.id)).toEqual([...rows].reverse().map((r) => r.id));
    expect(h.queries).toHaveLength(2);
    expect(h.queries[1].gt).toEqual([['id', 'a0999']]);
  });

  it('listActivitiesForContacts traverses pages and keeps the contact membership filter', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({
      id: `a${String(i).padStart(4, '0')}`,
      contact_id: i === 1000 ? 'ct-other' : 'ct1',
      occurred_at: `2026-01-01T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z`,
    }));
    h.setRows(rows);
    const result = await listActivitiesForContacts(['ct1']);
    expect(result).toHaveLength(1000);
    expect(h.queries).toHaveLength(2);
    expect(h.queries[0].memberships).toEqual([['contact_id', ['ct1']]]);
    expect(h.queries[1].gt).toEqual([['id', 'a0999']]);
  });

  it('a failed continuation page rejects with its Postgres code instead of resolving partial', async () => {
    h.setRows(Array.from({ length: 1001 }, (_, i) => ({
      id: `c${String(i).padStart(4, '0')}`,
      name: `Company ${i}`,
      type: 'Client',
      archived_at: null,
    })));
    h.setError({ message: 'page failed', code: '42501' }, 1);
    await expect(listCompanies()).rejects.toMatchObject({ message: 'page failed', code: '42501' });
  });
});
