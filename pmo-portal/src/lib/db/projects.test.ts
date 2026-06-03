import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Mock the Supabase query builder chain:
 *   supabase.from('projects').select(SELECT)           → thenable
 *   supabase.from('projects').select(SELECT).eq(k, v)  → thenable
 *
 * All mocks are hoisted so they are available to vi.mock factories.
 */
const { mockEq, mockSelect, mockFrom } = vi.hoisted(() => {
  const mockEq = vi.fn();
  const mockSelect = vi.fn();
  const mockFrom = vi.fn();
  return { mockEq, mockSelect, mockFrom };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: mockFrom } }));

import { listProjects } from './projects';

/** Wire the builder chain and set what it resolves to. */
function makeBuilder(resolved: { data: unknown; error: unknown }) {
  const builder = {
    select: mockSelect,
    eq: mockEq,
    then: (resolve: (v: typeof resolved) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(resolved).then(resolve, reject),
  };
  mockSelect.mockReturnValue(builder);
  mockEq.mockReturnValue(builder);
  mockFrom.mockReturnValue(builder);
  return builder;
}

beforeEach(() => {
  mockFrom.mockReset();
  mockSelect.mockReset();
  mockEq.mockReset();
});

describe('listProjects', () => {
  it('selects projects joining client name + PM name; returns rows (AC-409, FR-DAL-001)', async () => {
    const rows = [{
      id: '40000000-0000-0000-0000-000000000001', name: 'Innovate Corp HQ Fit-Out',
      status: 'Ongoing Project', client_id: 'c2', project_manager_id: 'a2',
      contract_value: 5000000, budget: 4700000, spent: 2100000,
      start_date: '2026-01-06', end_date: '2026-12-18',
      client: { name: 'Innovate Corp' }, pm: { full_name: 'Alice Manager' },
    }];
    makeBuilder({ data: rows, error: null });
    const result = await listProjects();
    expect(mockFrom).toHaveBeenCalledWith('projects');
    expect(mockSelect).toHaveBeenCalledWith('*, client:companies(name), pm:profiles(full_name)');
    expect(result[0].client?.name).toBe('Innovate Corp');
    expect(result[0].pm?.full_name).toBe('Alice Manager');
  });

  it('sends no org_id (RLS scopes it) (FR-DAL-004)', async () => {
    makeBuilder({ data: [], error: null });
    await listProjects();
    expect(JSON.stringify(mockSelect.mock.calls)).not.toContain('org_id');
    expect(JSON.stringify(mockEq.mock.calls)).not.toContain('org_id');
  });

  it('throws on PostgREST error (AC-409, FR-DAL-003)', async () => {
    makeBuilder({ data: null, error: { message: 'boom' } });
    await expect(listProjects()).rejects.toThrow('boom');
  });

  it('calls .eq("status", …) when status param is provided (OD-3)', async () => {
    makeBuilder({ data: [], error: null });
    await listProjects({ status: 'Ongoing Project' });
    expect(mockEq).toHaveBeenCalledWith('status', 'Ongoing Project');
  });

  it('does NOT call .eq("status", …) when status param is absent', async () => {
    makeBuilder({ data: [], error: null });
    await listProjects();
    const statusCalls = mockEq.mock.calls.filter(([k]) => k === 'status');
    expect(statusCalls).toHaveLength(0);
  });

  it('calls .eq("project_manager_id", …) when pmId param is provided (OD-3)', async () => {
    makeBuilder({ data: [], error: null });
    await listProjects({ pmId: 'u-alice' });
    expect(mockEq).toHaveBeenCalledWith('project_manager_id', 'u-alice');
  });

  it('does NOT call .eq("project_manager_id", …) when pmId param is absent', async () => {
    makeBuilder({ data: [], error: null });
    await listProjects();
    const pmCalls = mockEq.mock.calls.filter(([k]) => k === 'project_manager_id');
    expect(pmCalls).toHaveLength(0);
  });
});
