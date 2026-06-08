import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Mock the Supabase query builder chain:
 *   supabase.from('projects').select(SELECT)           → thenable
 *   supabase.from('projects').select(SELECT).eq(k, v)  → thenable
 *
 * All mocks are hoisted so they are available to vi.mock factories.
 */
const { mockEq, mockSelect, mockFrom, mockRpc } = vi.hoisted(() => {
  const mockEq = vi.fn();
  const mockSelect = vi.fn();
  const mockFrom = vi.fn();
  const mockRpc = vi.fn();
  return { mockEq, mockSelect, mockFrom, mockRpc };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: mockFrom, rpc: mockRpc } }));

import {
  listProjects,
  createProject,
  updateProjectHeader,
  archiveProject,
  deleteProject,
  setProjectContractValue,
} from './projects';
import { AppError } from '@/src/lib/appError';

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

/**
 * A fuller chainable write-builder for insert/update/delete paths. Every method
 * records its args and returns the same builder so chaining order is free; the
 * builder is thenable so `await builder` resolves the queued result. `.single()`
 * / `.maybeSingle()` also resolve the result so create returns the row.
 */
function makeWriteBuilder(resolved: { data: unknown; error: unknown }) {
  const calls = {
    insert: [] as unknown[],
    update: [] as unknown[],
    delete: 0,
    eq: [] as unknown[],
    select: 0,
    single: 0,
  };
  const builder: Record<string, unknown> = {};
  builder.insert = (arg: unknown) => {
    calls.insert.push(arg);
    return builder;
  };
  builder.update = (arg: unknown) => {
    calls.update.push(arg);
    return builder;
  };
  builder.delete = () => {
    calls.delete++;
    return builder;
  };
  builder.eq = (...args: unknown[]) => {
    calls.eq.push(args);
    return builder;
  };
  builder.select = () => {
    calls.select++;
    return builder;
  };
  builder.single = () => {
    calls.single++;
    return Promise.resolve(resolved);
  };
  builder.then = (resolve: (v: typeof resolved) => void, reject?: (e: unknown) => void) =>
    Promise.resolve(resolved).then(resolve, reject);
  mockFrom.mockReturnValue(builder);
  return calls;
}

beforeEach(() => {
  mockFrom.mockReset();
  mockSelect.mockReset();
  mockEq.mockReset();
  mockRpc.mockReset();
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

describe('AC-PRJ-003 createProject (create a Leads / Internal opportunity)', () => {
  it('AC-PRJ-003: inserts name/status/client/pm/value/dates, NEVER org_id, returns the new row', async () => {
    const calls = makeWriteBuilder({
      data: { id: 'new', name: 'Harborside Terminal', status: 'Leads' },
      error: null,
    });
    const row = await createProject({
      name: 'Harborside Terminal',
      status: 'Leads',
      client_id: 'c2',
      project_manager_id: 'a2',
      contract_value: 4820000,
      start_date: null,
      end_date: null,
    });
    expect(mockFrom).toHaveBeenCalledWith('projects');
    const insert = calls.insert[0] as Record<string, unknown>;
    expect(insert).toMatchObject({
      name: 'Harborside Terminal',
      status: 'Leads',
      client_id: 'c2',
      project_manager_id: 'a2',
      contract_value: 4820000,
    });
    // org_id is NEVER sent — RLS stamps it from the column default.
    expect(JSON.stringify(calls.insert)).not.toContain('org_id');
    expect(calls.single).toBe(1);
    expect(row.id).toBe('new');
  });

  it('AC-PRJ-003: an on-hand origination status is rejected client-side (win-transition only)', async () => {
    makeWriteBuilder({ data: null, error: null });
    // Director decision: on-hand is reached ONLY via transition_project win; never created directly.
    await expect(
      createProject({
        name: 'Bad',
        status: 'Ongoing Project',
        client_id: 'c2',
        project_manager_id: null,
        contract_value: 0,
        start_date: null,
        end_date: null,
      }),
    ).rejects.toThrow(/origination/i);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('AC-PRJ-003: throws AppError preserving code 42501 when RLS denies the insert', async () => {
    makeWriteBuilder({ data: null, error: { message: 'new row violates RLS', code: '42501' } });
    await expect(
      createProject({
        name: 'X',
        status: 'Leads',
        client_id: null,
        project_manager_id: null,
        contract_value: 0,
        start_date: null,
        end_date: null,
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('AC-PRJ-004 updateProjectHeader (edit name/client/PM/code/dates)', () => {
  it('AC-PRJ-004: updates only header columns (no contract_value, no status), NEVER org_id', async () => {
    const calls = makeWriteBuilder({ data: null, error: null });
    await updateProjectHeader('p1', {
      name: 'Renamed',
      code: 'OPP-2041',
      client_id: 'c3',
      project_manager_id: 'a2',
      start_date: '2026-01-06',
      end_date: '2026-12-18',
    });
    expect(mockFrom).toHaveBeenCalledWith('projects');
    const patch = calls.update[0] as Record<string, unknown>;
    expect(patch).toMatchObject({
      name: 'Renamed',
      code: 'OPP-2041',
      client_id: 'c3',
      project_manager_id: 'a2',
    });
    // contract_value and status are NOT part of the header patch (SoD-gated / RPC-only).
    expect(patch).not.toHaveProperty('contract_value');
    expect(patch).not.toHaveProperty('status');
    expect(calls.eq).toContainEqual(['id', 'p1']);
    expect(JSON.stringify(patch)).not.toContain('org_id');
  });

  it('AC-PRJ-004: throws AppError with code on a denied update', async () => {
    makeWriteBuilder({ data: null, error: { message: 'denied', code: '42501' } });
    await expect(
      updateProjectHeader('p1', {
        name: 'Y',
        code: null,
        client_id: null,
        project_manager_id: null,
        start_date: null,
        end_date: null,
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('AC-PRJ-005 archiveProject (soft-archive via archived_at)', () => {
  it('AC-PRJ-005: sets archived_at via update by id, NEVER org_id', async () => {
    const calls = makeWriteBuilder({ data: null, error: null });
    await archiveProject('p1');
    expect(mockFrom).toHaveBeenCalledWith('projects');
    const patch = calls.update[0] as Record<string, unknown>;
    expect(patch).toHaveProperty('archived_at');
    expect(patch.archived_at).not.toBeNull();
    expect(calls.eq).toContainEqual(['id', 'p1']);
    expect(JSON.stringify(patch)).not.toContain('org_id');
  });

  it('AC-PRJ-005: throws AppError with code on a denied archive', async () => {
    makeWriteBuilder({ data: null, error: { message: 'denied', code: '42501' } });
    await expect(archiveProject('p1')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('AC-PRJ-007 deleteProject (hard delete, Admin-only)', () => {
  it('AC-PRJ-007: deletes by id, NEVER org_id', async () => {
    const calls = makeWriteBuilder({ data: null, error: null });
    await deleteProject('p1');
    expect(mockFrom).toHaveBeenCalledWith('projects');
    expect(calls.delete).toBe(1);
    expect(calls.eq).toContainEqual(['id', 'p1']);
    expect(JSON.stringify(calls.eq)).not.toContain('org_id');
  });

  it('AC-PRJ-007: throws AppError preserving the Postgres code on a denied/blocked delete', async () => {
    makeWriteBuilder({ data: null, error: { message: 'denied', code: '42501' } });
    await expect(deleteProject('p1')).rejects.toBeInstanceOf(AppError);
    makeWriteBuilder({ data: null, error: { message: 'referenced', code: '23503' } });
    await expect(deleteProject('p1')).rejects.toMatchObject({ code: '23503' });
  });
});

describe('AC-PRJ-006 setProjectContractValue (SoD-gated RPC, ADR-0019)', () => {
  it('AC-PRJ-006: calls the set_project_contract_value RPC with p_id + p_value, NEVER org_id', async () => {
    mockRpc.mockResolvedValue({ error: null });
    await setProjectContractValue('p1', 5140000);
    expect(mockRpc).toHaveBeenCalledWith('set_project_contract_value', {
      p_id: 'p1',
      p_value: 5140000,
    });
    expect(JSON.stringify(mockRpc.mock.calls)).not.toContain('org_id');
  });

  it('AC-PRJ-006: surfaces the RPC SoD rejection as AppError preserving code 42501', async () => {
    mockRpc.mockResolvedValue({ error: { message: 'not authorized', code: '42501' } });
    const err = await setProjectContractValue('p1', 1).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('42501');
  });
});
