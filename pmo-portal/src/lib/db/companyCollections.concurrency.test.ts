import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageResult } from '@/src/lib/pagedRead';

// DAL01-006 / DAL03-007 (THEME-DATA-61): the independent 100-id input chunks each run their own
// sequential keyset traversal, but the chunks themselves were awaited SERIALLY — one network round
// trip per chunk before any results appear. The chunks must be fetched with BOUNDED concurrency
// (sequential paging preserved inside each chunk, deterministic chunk-order result, dedupe intact).
const h = vi.hoisted(() => {
  interface Query {
    table: string;
    columns: string;
    eq: Array<[string, string]>;
    memberships: Array<[string, string[]]>;
    order: Array<[string, { ascending?: boolean } | undefined]>;
    gt: Array<[string, string]>;
    limit: number | null;
  }
  const queries: Query[] = [];
  let rows: Array<Record<string, unknown>> = [];
  // Each query's resolution is held until released, so the test can observe how many chunk
  // traversals are IN FLIGHT before any of them completes.
  let resolvers: Array<(page: PageResult<Record<string, unknown>>) => void> = [];
  const from = vi.fn((table: string) => {
    const query: Query = { table, columns: '', eq: [], memberships: [], order: [], gt: [], limit: null };
    const index = queries.length;
    queries.push(query);
    const builder: Record<string, unknown> = {};
    builder.select = (columns: string) => { query.columns = columns; return builder; };
    builder.eq = (column: string, value: string) => { query.eq.push([column, value]); return builder; };
    builder.in = (column: string, values: string[]) => { query.memberships.push([column, [...values]]); return builder; };
    builder.order = (column: string, options?: { ascending?: boolean }) => { query.order.push([column, options]); return builder; };
    builder.gt = (column: string, value: string) => { query.gt.push([column, value]); return builder; };
    builder.limit = (value: number) => { query.limit = value; return builder; };
    builder.then = (resolve: (value: unknown) => void) => {
      resolvers.push((page) => resolve(page));
      // Defer so the caller controls resolution order.
      return Promise.resolve().then(() => undefined);
    };
    void index;
    return builder;
  });
  return {
    from,
    queries,
    setRows: (next: Array<Record<string, unknown>>) => { rows = next; },
    // Resolve every released builder whose filter matches, in query order.
    releaseAll: () => {
      const pending = resolvers;
      resolvers = [];
      pending.forEach((resolve, i) => {
        const query = queries[i]!;
        const selected = rows.filter((row) =>
          query.eq.every(([column, value]) => row[column] === value)
          && query.memberships.every(([column, values]) => values.includes(String(row[column])))
        );
        for (const [column, options] of query.order) {
          selected.sort((left, right) => {
            const direction = options?.ascending === false ? -1 : 1;
            return direction * String(left[column] ?? '').localeCompare(String(right[column] ?? ''));
          });
        }
        for (const [column, value] of query.gt) {
          for (let j = selected.length - 1; j >= 0; j -= 1) {
            if (String(selected[j]![column]) <= value) selected.splice(j, 1);
          }
        }
        resolve({ data: selected.slice(0, query.limit ?? undefined), error: null });
      });
    },
    flushMicrotasks: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
    reset: () => { queries.length = 0; rows = []; resolvers = []; from.mockClear(); },
  };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { listCompanyCustomerRefs } from './companyCollections';

beforeEach(() => h.reset());

describe('concurrent chunk fetch (DAL01-006/DAL03-007)', () => {
  it('issues every input chunk before the first chunk resolves, and returns complete, chunk-ordered results', async () => {
    // 250 ids → 3 chunks of 100/100/50 (INPUT_CHUNK_SIZE = 100).
    const ids = Array.from({ length: 250 }, (_, i) => `company-${String(i).padStart(3, '0')}`);
    const rows = ids.flatMap((companyId, i) => [
      { id: `ref-${i}`, domain: 'companies', external_tier: 'erpnext', pmo_record_id: companyId, external_record_id: `Customer:C-${String(i).padStart(3, '0')}` },
    ]);
    h.setRows(rows);

    const pending = listCompanyCustomerRefs(ids);
    // Let the workers start and reach their first await WITHOUT resolving anything.
    await h.flushMicrotasks();

    // Under the old serial loop only the FIRST chunk's query would exist here.
    expect(h.queries).toHaveLength(3);
    expect(h.queries[0]!.memberships[0]![1]).toHaveLength(100);
    expect(h.queries[1]!.memberships[0]![1]).toHaveLength(100);
    expect(h.queries[2]!.memberships[0]![1]).toHaveLength(50);
    // Each chunk keeps its own sequential keyset traversal: id-ordered, bounded.
    for (const query of h.queries) {
      expect(query.order).toContainEqual(['id', { ascending: true }]);
      expect(query.limit).toBe(1000);
    }

    h.releaseAll();
    const refs = await pending;
    expect(refs).toHaveLength(250);
    // Deterministic: chunk order, and within a chunk the mapped pair order.
    expect(refs[0]).toEqual({ companyId: 'company-000', erpCustomerId: 'Customer:C-000' });
    expect(refs[99]).toEqual({ companyId: 'company-099', erpCustomerId: 'Customer:C-099' });
    expect(refs[100]).toEqual({ companyId: 'company-100', erpCustomerId: 'Customer:C-100' });
    expect(refs[249]).toEqual({ companyId: 'company-249', erpCustomerId: 'Customer:C-249' });
  });

  it('keeps deduplication of repeated (company, erp customer) pairs across concurrent chunks', async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `company-${String(i).padStart(3, '0')}`);
    const rows = [
      ...ids.map((companyId, i) => ({ id: `ref-a-${i}`, domain: 'companies', external_tier: 'erpnext', pmo_record_id: companyId, external_record_id: `Customer:C-${String(i).padStart(3, '0')}` })),
      // Same pair as ref-a-0, different row id — must dedupe to one ref.
      { id: 'ref-b-dup', domain: 'companies', external_tier: 'erpnext', pmo_record_id: 'company-000', external_record_id: 'Customer:C-000' },
    ];
    h.setRows(rows);

    const pending = listCompanyCustomerRefs(ids);
    await h.flushMicrotasks();
    expect(h.queries).toHaveLength(2);
    h.releaseAll();
    const refs = await pending;
    expect(refs).toHaveLength(120);
    expect(refs.filter((r) => r.companyId === 'company-000' && r.erpCustomerId === 'Customer:C-000')).toHaveLength(1);
  });
});
