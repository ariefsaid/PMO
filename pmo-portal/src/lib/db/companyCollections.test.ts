import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const queries: Array<{
    table: string;
    columns: string;
    eq: Array<[string, string]>;
    memberships: Array<[string, string[]]>;
    order: Array<[string, { ascending?: boolean } | undefined]>;
    gt: Array<[string, string]>;
    limit: number | null;
  }> = [];
  let rows: Array<Record<string, unknown>> = [];
  let error: { message: string; code?: string } | null = null;
  const from = vi.fn((table: string) => {
    const query = { table, columns: '', eq: [], memberships: [], order: [], gt: [], limit: null } as (typeof queries)[number];
    queries.push(query);
    const builder: Record<string, unknown> = {};
    builder.select = (columns: string) => { query.columns = columns; return builder; };
    builder.eq = (column: string, value: string) => { query.eq.push([column, value]); return builder; };
    builder.in = (column: string, values: string[]) => { query.memberships.push([column, [...values]]); return builder; };
    builder.order = (column: string, options?: { ascending?: boolean }) => { query.order.push([column, options]); return builder; };
    builder.gt = (column: string, value: string) => { query.gt.push([column, value]); return builder; };
    builder.limit = (value: number) => { query.limit = value; return builder; };
    builder.then = (resolve: (value: unknown) => unknown) => {
      let selected = rows.filter((row) =>
        query.eq.every(([column, value]) => row[column] === value)
        && query.memberships.every(([column, values]) => values.includes(String(row[column]))),
      );
      for (const [column, options] of query.order) {
        selected = [...selected].sort((left, right) => {
          const direction = options?.ascending === false ? -1 : 1;
          return direction * String(left[column] ?? '').localeCompare(String(right[column] ?? ''));
        });
      }
      for (const [column, value] of query.gt) selected = selected.filter((row) => String(row[column] ?? '') > value);
      return resolve({ data: selected.slice(0, query.limit ?? undefined), error });
    };
    return builder;
  });
  return {
    from,
    queries,
    setRows: (next: Array<Record<string, unknown>>) => { rows = next; },
    setError: (next: { message: string; code?: string } | null) => { error = next; },
    reset: () => { queries.length = 0; rows = []; error = null; from.mockClear(); },
  };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { listCompanyCustomerRefs, listCompanyCustomerRefsByErpCustomerIds } from './companyCollections';

beforeEach(() => h.reset());

describe('company customer reference reads', () => {
  it('reads exact company refs through RLS, validates Customer ids, and maps only stable IDs', async () => {
    h.setRows([
      { id: 'ref-a', domain: 'companies', external_tier: 'erpnext', pmo_record_id: 'company-a', external_record_id: 'Customer:C-0001' },
      { id: 'ref-b', domain: 'companies', external_tier: 'erpnext', pmo_record_id: 'company-b', external_record_id: 'Customer:C-0002' },
      { id: 'ref-supplier', domain: 'companies', external_tier: 'erpnext', pmo_record_id: 'company-a', external_record_id: 'Supplier:C-0001' },
      { id: 'ref-empty', domain: 'companies', external_tier: 'erpnext', pmo_record_id: 'company-a', external_record_id: 'Customer:' },
      { id: 'ref-other-tier', domain: 'companies', external_tier: 'reference', pmo_record_id: 'company-a', external_record_id: 'Customer:C-0003' },
    ]);

    const refs = await listCompanyCustomerRefs(['company-a', 'company-b', 'company-a']);

    expect(h.queries).toHaveLength(1);
    expect(h.queries[0]).toMatchObject({
      table: 'external_refs',
      columns: 'id,pmo_record_id,external_record_id',
      eq: [['domain', 'companies'], ['external_tier', 'erpnext']],
      memberships: [['pmo_record_id', ['company-a', 'company-b']]],
      order: [['id', { ascending: true }]],
      gt: [],
      limit: 1000,
    });
    expect(refs).toEqual([
      { companyId: 'company-a', erpCustomerId: 'Customer:C-0001' },
      { companyId: 'company-b', erpCustomerId: 'Customer:C-0002' },
    ]);
  });

  it('batches finance lookup by exact Customer ids instead of querying once per party', async () => {
    h.setRows([
      { id: 'ref-a', domain: 'companies', external_tier: 'erpnext', pmo_record_id: 'company-a', external_record_id: 'Customer:C-0001' },
      { id: 'ref-b', domain: 'companies', external_tier: 'erpnext', pmo_record_id: 'company-b', external_record_id: 'Customer:C-0002' },
    ]);

    const refs = await listCompanyCustomerRefsByErpCustomerIds(['Customer:C-0001', 'Customer:C-0002']);

    expect(h.queries).toHaveLength(1);
    expect(h.queries[0]!.memberships).toEqual([['external_record_id', ['Customer:C-0001', 'Customer:C-0002']]]);
    expect(refs).toEqual([
      { companyId: 'company-a', erpCustomerId: 'Customer:C-0001' },
      { companyId: 'company-b', erpCustomerId: 'Customer:C-0002' },
    ]);
  });

  it('chunks a large visible company list and keyset-pages every matching ref', async () => {
    const companyIds = Array.from({ length: 101 }, (_, index) => `company-${String(index).padStart(3, '0')}`);
    h.setRows(Array.from({ length: 1001 }, (_, index) => ({
      id: `ref-${String(index).padStart(4, '0')}`,
      domain: 'companies',
      external_tier: 'erpnext',
      pmo_record_id: 'company-000',
      external_record_id: `Customer:C-${String(index).padStart(4, '0')}`,
    })));

    const refs = await listCompanyCustomerRefs(companyIds);

    expect(refs).toHaveLength(1001);
    expect(h.queries).toHaveLength(3);
    expect(h.queries.map((query) => query.memberships[0]![1].length)).toEqual([100, 100, 1]);
    expect(h.queries.map((query) => query.order)).toEqual(Array.from({ length: 3 }, () => [['id', { ascending: true }]]));
    expect(h.queries[1]!.gt).toEqual([['id', 'ref-0999']]);
    expect(h.queries.every((query) => query.limit === 1000)).toBe(true);
  });

  it('keeps PostgREST read failures distinguishable from an empty reference set', async () => {
    h.setError({ message: 'read denied', code: '42501' });

    await expect(listCompanyCustomerRefs(['company-a'])).rejects.toMatchObject({ message: 'read denied', code: '42501' });
  });
});
