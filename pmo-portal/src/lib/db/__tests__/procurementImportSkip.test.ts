import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * AC-IDEM-006 (real lookup) — proves the LIVE supabaseImportSkipLookup builds the correct
 * Supabase query sequence: NO org_id equality filter (RLS scopes reads to the caller's org),
 * correct import_key/batch handling, and cross-batch collision excludes the current batch
 * (.neq) and filters out null-batch rows (.not).
 *
 * These assertions failed before the fix-round A1 change (which removed the dead
 * `.eq('org_id', '')` filter that made header idempotency a no-op in production).
 */

// A chainable fake query-builder that records every call in order.
interface Call {
  method: string;
  args: unknown[];
}

function makeFakeBuilder(result: unknown) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'neq', 'not', 'limit']) {
    builder[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return builder;
    };
  }
  builder.maybeSingle = (...args: unknown[]) => {
    calls.push({ method: 'maybeSingle', args });
    return Promise.resolve({ data: result });
  };
  return { builder, calls };
}

// Mock the supabase client. `from` records the table and returns the current fake builder.
const fromCalls: string[] = [];
let currentBuilder: { builder: Record<string, unknown>; calls: Call[] };
let rpcHandler: (name: string, args: unknown) => Promise<unknown>;

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: {
    rpc: (name: string, args: unknown) => rpcHandler(name, args),
    from: (table: string) => {
      fromCalls.push(table);
      return currentBuilder.builder;
    },
  },
}));

import { supabaseImportSkipLookup } from '../procurementImportSkip';

function colFilters(calls: Call[]): string[] {
  return calls.filter((c) => c.method === 'eq').map((c) => c.args[0] as string);
}

describe('supabaseImportSkipLookup.findExistingCase — AC-IDEM-006 (real lookup)', () => {
  beforeEach(() => {
    fromCalls.length = 0;
  });

  it('queries procurements by import_key + import_batch_id and does NOT filter on org_id', async () => {
    currentBuilder = makeFakeBuilder({ id: 'proc-1' });
    const result = await supabaseImportSkipLookup.findExistingCase('CASE-1', 'batch-1');

    expect(result).toEqual({ id: 'proc-1' });
    expect(fromCalls).toEqual(['procurements']);
    const filters = colFilters(currentBuilder.calls);
    expect(filters).toContain('import_key');
    expect(filters).toContain('import_batch_id');
    // The dead org_id filter must be gone — RLS scopes the read.
    expect(filters).not.toContain('org_id');
  });

  it('returns null when the query yields no row', async () => {
    currentBuilder = makeFakeBuilder(null);
    const result = await supabaseImportSkipLookup.findExistingCase('CASE-NEW', 'batch-1');
    expect(result).toBeNull();
  });
});

describe('supabaseImportSkipLookup.findExistingRecord — AC-IDEM-006 (real lookup)', () => {
  beforeEach(() => {
    fromCalls.length = 0;
  });

  it('queries the record table by procurement_id + import_key + import_batch_id (procurement_id is a real FK scope, not a tenancy substitute)', async () => {
    currentBuilder = makeFakeBuilder({ id: 'rec-1' });
    const result = await supabaseImportSkipLookup.findExistingRecord(
      'purchase_requests',
      'proc-1',
      'PR-1',
      'batch-1',
    );

    expect(result).toEqual({ id: 'rec-1' });
    expect(fromCalls).toEqual(['purchase_requests']);
    const filters = colFilters(currentBuilder.calls);
    expect(filters).toEqual(
      expect.arrayContaining(['procurement_id', 'import_key', 'import_batch_id']),
    );
    expect(filters).not.toContain('org_id');
  });
});

describe('supabaseImportSkipLookup.findCrossBatchCollision — FR-IDEM-006 (real lookup)', () => {
  beforeEach(() => {
    fromCalls.length = 0;
  });

  it('excludes the current batch (.neq) and filters out null-batch rows (.not), with no org_id filter', async () => {
    currentBuilder = makeFakeBuilder({ id: 'other', import_batch_id: 'batch-old' });
    const result = await supabaseImportSkipLookup.findCrossBatchCollision(
      'procurements',
      'CASE-1',
      'batch-1',
    );

    expect(result).toEqual({ id: 'other', import_batch_id: 'batch-old' });
    expect(fromCalls).toEqual(['procurements']);

    const neq = currentBuilder.calls.find((c) => c.method === 'neq');
    expect(neq?.args).toEqual(['import_batch_id', 'batch-1']);

    const not = currentBuilder.calls.find((c) => c.method === 'not');
    expect(not?.args).toEqual(['import_batch_id', 'is', null]);

    const filters = colFilters(currentBuilder.calls);
    expect(filters).toContain('import_key');
    expect(filters).not.toContain('org_id');
  });

  it('scopes record-table collisions by procurement_id when a procurementId is supplied', async () => {
    currentBuilder = makeFakeBuilder(null);
    await supabaseImportSkipLookup.findCrossBatchCollision(
      'purchase_requests',
      'PR-1',
      'batch-1',
      'proc-1',
    );
    const filters = colFilters(currentBuilder.calls);
    expect(filters).toContain('procurement_id');
    expect(filters).not.toContain('org_id');
  });
});


it('propagates a lookup error rather than treating it as an absent case', async () => {
  const error = { code: 'PGRST116', message: 'unexpected cardinality' };
  currentBuilder = makeFakeBuilder(null);
  currentBuilder.builder.maybeSingle = () => Promise.resolve({ data: null, error });
  await expect(supabaseImportSkipLookup.findExistingCase('case', 'batch')).rejects.toEqual(error);
});

it('reads all pages of records scoped to a case with bounded queries', async () => {
  const pages = [Array.from({ length: 200 }, (_, i) => ({ id: `r${i}`, import_key: `k${i}`, import_batch_id: 'old' })), [{ id: 'last', import_key: 'last', import_batch_id: 'old' }]];
  const cursors: string[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'not', 'order', 'filter']) builder[method] = () => builder;
  const filters: unknown[][] = [];
  const scopes: unknown[][] = [];
  builder.eq = (...args: unknown[]) => { scopes.push(args); return builder; };
  builder.filter = (...args: unknown[]) => { filters.push(args); return builder; };
  builder.gt = (_column: string, cursor: string) => { cursors.push(cursor); return builder; };
  builder.limit = () => Promise.resolve({ data: pages.shift(), error: null });
  currentBuilder = { builder, calls: [] };
  const rows = await supabaseImportSkipLookup.listCaseRecords!('purchase_requests', 'case', ['k0']);
  expect(rows).toHaveLength(201);
  expect(cursors).toEqual(['r199']);
  expect(scopes).toEqual([['procurement_id', 'case'], ['procurement_id', 'case']]);
  expect(filters).toEqual([['import_key', 'in', '("k0")'], ['import_key', 'in', '("k0")']]);
});

it('rejects a paginated read error instead of returning partial results', async () => {
  const error = { code: 'PGRST116', message: 'unexpected cardinality' };
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'not', 'order', 'filter']) builder[method] = () => builder;
  builder.limit = () => Promise.resolve({ data: null, error });
  currentBuilder = { builder, calls: [] };
  await expect(supabaseImportSkipLookup.listCaseRecords!('purchase_orders', 'case', ['key'])).rejects.toMatchObject(error);
});

it('chunks a large key set into bounded queries', async () => {
  const batches: string[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'not', 'order']) builder[method] = () => builder;
  builder.filter = (_column: string, _operator: string, keys: string) => { batches.push(keys); return builder; };
  builder.limit = () => Promise.resolve({ data: [], error: null });
  currentBuilder = { builder, calls: [] };
  const keys = Array.from({ length: 205 }, (_, index) => `key-${index}`);
  expect(await supabaseImportSkipLookup.listCaseRecords!('purchase_orders', 'case', keys)).toEqual([]);
  expect(batches.map(batch => batch.split(',').length)).toEqual([100, 100, 5]);
});

it('batches case keys in bounded RLS-scoped queries', async () => {
  const batches: string[][] = [];
  rpcHandler = async (_name, args) => {
    batches.push((args as { p_refs: string[] }).p_refs);
    return { data: [], error: null };
  };
  await supabaseImportSkipLookup.listCases!(Array.from({ length: 500 }, (_, i) => `case-${i}`));
  expect(batches.map(batch => batch.length)).toEqual([200, 200, 100]);
});

it('reads identity metadata and retains records with null batches', async () => {
  const selected: string[] = [];
  const excluded: unknown[][] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['eq', 'order', 'filter']) builder[method] = () => builder;
  builder.select = (columns: string) => { selected.push(columns); return builder; };
  builder.not = (...args: unknown[]) => { excluded.push(args); return builder; };
  builder.limit = () => Promise.resolve({ data: [{ id: 'x', import_key: 'K', import_batch_id: null, import_identity_version: null, import_identity_facts: null }], error: null });
  currentBuilder = { builder, calls: [] };
  const result = await supabaseImportSkipLookup.listCaseRecords!('purchase_orders', 'case', ['K']);
  expect(result[0].import_batch_id).toBeNull();
  expect(selected[0]).toContain('import_identity_facts');
  expect(excluded).toEqual([]);
});

it('uses bounded normalized case lookup and exhausts two-part cursor pages', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const page = Array.from({ length: 200 }, (_, i) => ({ id: `id-${i}`, import_key: 'Case', import_batch_id: null, normalized_ref: 'case' }));
  rpcHandler = async (name, args) => {
    calls.push({ name, args: args as Record<string, unknown> });
    return { data: calls.length === 1 ? page : [{ id: 'last', import_key: 'Case', import_batch_id: null, normalized_ref: 'case' }], error: null };
  };
  const rows = await supabaseImportSkipLookup.listCases!(['Case']);
  expect(rows).toHaveLength(201);
  expect(calls.map(call => call.name)).toEqual(['lookup_procurement_import_cases', 'lookup_procurement_import_cases']);
  expect(calls[1].args).toMatchObject({ p_after_key: 'case', p_after_id: 'id-199' });
  expect(calls[0].args).not.toHaveProperty('p_org_id');
});

it('uses database normalization for incoming refs in bounded chunks', async () => {
  const sizes: number[] = [];
  rpcHandler = async (_name, args) => {
    const refs = (args as { p_refs: string[] }).p_refs;
    sizes.push(refs.length);
    return { data: refs.map(input_ref => ({ input_ref, normalized_ref: input_ref === 'İ' ? 'i' : input_ref })), error: null };
  };
  const refs = ['İ', ...Array.from({ length: 200 }, (_, i) => `K${i}`)];
  const normalized = await supabaseImportSkipLookup.normalizeCases!(refs);
  expect(normalized.get('İ')).toBe('i');
  expect(sizes).toEqual([200, 1]);
});

it('escapes quotes and backslashes in batched identity filters', async () => {
  const filters: string[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order']) builder[method] = () => builder;
  builder.filter = (_column: string, _operator: string, value: string) => { filters.push(value); return builder; };
  builder.in = () => builder;
  builder.not = () => builder;
  builder.limit = () => Promise.resolve({ data: [], error: null });
  currentBuilder = { builder, calls: [] };
  await supabaseImportSkipLookup.listCaseRecords!('purchase_orders', 'case', ['pcy2:["r","a\\b"]']);
  expect(filters).toEqual(['("pcy2:[\\"r\\",\\"a\\\\b\\"]")']);
});

it('rejects malformed record lookup responses instead of assuming no matches', async () => {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'filter']) builder[method] = () => builder;
  builder.limit = () => Promise.resolve({ data: null, error: null });
  currentBuilder = { builder, calls: [] };
  await expect(supabaseImportSkipLookup.listCaseRecords!('purchase_orders', 'case', ['key'])).rejects.toThrow(/invalid/i);
});
