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

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: {
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
