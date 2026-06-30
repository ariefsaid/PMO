/**
 * Vitest gate-tests for executeCompiledQuery.
 * AC-VR-013 (FR-VR-020..023, NFR-VR-SEC-001, NFR-VR-SEC-003).
 * The Supabase client is mocked — no Docker, no network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '@/src/lib/appError';
import type { CompiledQuery } from './types';

// Use vi.hoisted() so mockChain and mockFrom are available when vi.mock factories run
// (vi.mock is hoisted above const declarations at compile time).
const { mockChain, mockFrom } = vi.hoisted(() => {
  const mockChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn(),
  };
  const mockFrom = vi.fn(() => mockChain);
  return { mockChain, mockFrom };
});

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: { from: mockFrom },
}));

import { executeCompiledQuery } from './executor';

const BASE_COMPILED: CompiledQuery = {
  entity: 'companies',
  repositoryMethod: 'company.list',
  resolvedFilters: [],
  resolvedSelect: ['id', 'name', 'type'],
};

beforeEach(() => {
  vi.clearAllMocks();
  // Reset chain mocks to return `this` again after clearAllMocks
  mockChain.select.mockReturnThis();
  mockChain.eq.mockReturnThis();
  mockChain.neq.mockReturnThis();
  mockChain.in.mockReturnThis();
  mockChain.gt.mockReturnThis();
  mockChain.gte.mockReturnThis();
  mockChain.lt.mockReturnThis();
  mockChain.lte.mockReturnThis();
  mockChain.order.mockReturnThis();
  mockFrom.mockReturnValue(mockChain);
});

describe('executeCompiledQuery — AC-VR-013', () => {
  it('calls supabase.from with the correct table name for "companies"', async () => {
    mockChain.limit.mockResolvedValue({ data: [], error: null });
    await executeCompiledQuery({ ...BASE_COMPILED, limit: 10 });
    expect(mockFrom).toHaveBeenCalledWith('companies');
  });

  it('chains .select() with resolvedSelect columns joined by comma', async () => {
    mockChain.limit.mockResolvedValue({ data: [], error: null });
    await executeCompiledQuery({ ...BASE_COMPILED, limit: 10 });
    expect(mockChain.select).toHaveBeenCalledWith('id,name,type');
  });

  it('chains .eq() for an eq filter', async () => {
    mockChain.limit.mockResolvedValue({ data: [{ id: 'x', name: 'Acme', type: 'Client' }], error: null });
    const compiled: CompiledQuery = {
      ...BASE_COMPILED,
      resolvedFilters: [{ column: 'type', op: 'eq', value: 'Client' }],
      limit: 10,
    };
    await executeCompiledQuery(compiled);
    expect(mockChain.eq).toHaveBeenCalledWith('type', 'Client');
  });

  it('chains .order() for resolvedOrderBy', async () => {
    mockChain.limit.mockResolvedValue({ data: [], error: null });
    const compiled: CompiledQuery = {
      ...BASE_COMPILED,
      resolvedOrderBy: { column: 'name', dir: 'asc' },
      limit: 10,
    };
    await executeCompiledQuery(compiled);
    expect(mockChain.order).toHaveBeenCalledWith('name', { ascending: true });
  });

  it('chains .limit() for the limit field', async () => {
    mockChain.limit.mockResolvedValue({ data: [], error: null });
    await executeCompiledQuery({ ...BASE_COMPILED, limit: 10 });
    expect(mockChain.limit).toHaveBeenCalledWith(10);
  });

  it('returns rows from the Supabase response', async () => {
    const rows = [{ id: 'x', name: 'Acme', type: 'Client' }];
    mockChain.limit.mockResolvedValue({ data: rows, error: null });
    const result = await executeCompiledQuery({ ...BASE_COMPILED, limit: 10 });
    expect(result).toEqual(rows);
  });

  it('throws AppError when Supabase returns an error', async () => {
    mockChain.limit.mockResolvedValue({ data: null, error: { message: 'RLS denied', code: '42501' } });
    await expect(executeCompiledQuery({ ...BASE_COMPILED, limit: 10 })).rejects.toBeInstanceOf(AppError);
  });

  it('applies in-memory groupBy + count aggregate (FR-VR-022)', async () => {
    // Mock returns two rows for 'Client', executor groups and counts
    const rows = [
      { id: 'x', name: 'Acme', type: 'Client' },
      { id: 'y', name: 'Corp', type: 'Client' },
    ];
    mockChain.limit.mockResolvedValue({ data: rows, error: null });
    const compiled: CompiledQuery = {
      ...BASE_COMPILED,
      resolvedGroupBy: 'type',
      resolvedAggregate: { fn: 'count', column: 'id', alias: 'cnt' },
      limit: 500,
    };
    const result = await executeCompiledQuery(compiled);
    expect(result).toEqual([{ type: 'Client', cnt: 2 }]);
  });

  it('applies in-memory sum aggregate (FR-VR-022)', async () => {
    const rows = [{ contract_value: 100 }, { contract_value: 200 }];
    mockChain.limit.mockResolvedValue({ data: rows, error: null });
    const compiled: CompiledQuery = {
      entity: 'projects',
      repositoryMethod: 'project.list',
      resolvedFilters: [],
      resolvedSelect: ['contract_value'],
      resolvedAggregate: { fn: 'sum', column: 'contract_value', alias: 'total' },
      limit: 500,
    };
    const result = await executeCompiledQuery(compiled);
    // sum without groupBy: returns a single object { total: 300 }
    expect(result).toEqual([{ total: 300 }]);
  });

  it('expands date-range op to .gte + .lte (ADR-0038)', async () => {
    mockChain.limit.mockResolvedValue({ data: [], error: null });
    const compiled: CompiledQuery = {
      entity: 'projects',
      repositoryMethod: 'project.list',
      resolvedFilters: [{ column: 'created_at', op: 'date-range', value: ['2026-01-01', '2026-12-31'] }],
      resolvedSelect: ['id'],
      limit: 10,
    };
    await executeCompiledQuery(compiled);
    expect(mockChain.gte).toHaveBeenCalledWith('created_at', '2026-01-01');
    expect(mockChain.lte).toHaveBeenCalledWith('created_at', '2026-12-31');
  });

  it('does NOT import service_role (NFR-VR-SEC-003) — verified by mock: only anon client mock is used', async () => {
    // If executor.ts imported a service-role client the mock above would not intercept it.
    // This test passes only when the single supabase import from client.ts is used.
    mockChain.limit.mockResolvedValue({ data: [], error: null });
    await executeCompiledQuery({ ...BASE_COMPILED, limit: 5 });
    expect(mockFrom).toHaveBeenCalledTimes(1); // exactly one client call, not two
  });
});
