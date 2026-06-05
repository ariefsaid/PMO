import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted mock setup — mirrors procurements.test.ts builder pattern,
// extended to cover both .from() chains AND .rpc() calls.
// ---------------------------------------------------------------------------

const { mockRpc, mockFrom, mockSelect, mockEq, mockOrder, mockLimit, mockUpdate, mockDelete, mockInsert, mockSingle } =
  vi.hoisted(() => {
    const mockRpc = vi.fn();
    const mockFrom = vi.fn();
    const mockSelect = vi.fn();
    const mockEq = vi.fn();
    const mockOrder = vi.fn();
    const mockLimit = vi.fn();
    const mockUpdate = vi.fn();
    const mockDelete = vi.fn();
    const mockInsert = vi.fn();
    const mockSingle = vi.fn();
    return { mockRpc, mockFrom, mockSelect, mockEq, mockOrder, mockLimit, mockUpdate, mockDelete, mockInsert, mockSingle };
  });

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: { from: mockFrom, rpc: mockRpc },
}));

import {
  deriveProjectBudget,
  listBudgetVersions,
  createLineItem,
  updateLineItem,
  deleteLineItem,
  createBudgetVersion,
  cloneVersion,
  activateVersion,
  archiveVersion,
  deleteDraftVersion,
} from './budgets';

// ---------------------------------------------------------------------------
// Builder helpers
// ---------------------------------------------------------------------------

/** Creates a chainable builder that resolves to `resolved` at .then() time. */
function makeRpcBuilder(resolved: { data: unknown; error: unknown }) {
  const builder = {
    then: (resolve: (v: typeof resolved) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(resolved).then(resolve, reject),
  };
  mockRpc.mockReturnValue(builder);
  return builder;
}

/**
 * Creates a chainable PostgREST builder. Each chained method returns the same builder
 * so the DAL can call .select().eq().order().limit() etc in any combination.
 */
function makeFromBuilder(resolved: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  const self = () => builder;
  builder.select = mockSelect.mockReturnValue(builder);
  builder.eq = mockEq.mockReturnValue(builder);
  builder.order = mockOrder.mockReturnValue(builder);
  builder.limit = mockLimit.mockReturnValue(builder);
  builder.update = mockUpdate.mockReturnValue(builder);
  builder.delete = mockDelete.mockReturnValue(builder);
  builder.insert = mockInsert.mockReturnValue(builder);
  builder.single = mockSingle.mockReturnValue(builder);
  // Make the builder thenable — awaiting it yields resolved
  builder.then = (resolve: (v: typeof resolved) => void, reject?: (e: unknown) => void) =>
    Promise.resolve(resolved).then(resolve, reject);
  void self; // suppress unused-var lint
  mockFrom.mockReturnValue(builder);
  return builder;
}

beforeEach(() => {
  mockRpc.mockReset();
  mockFrom.mockReset();
  mockSelect.mockReset();
  mockEq.mockReset();
  mockOrder.mockReset();
  mockLimit.mockReset();
  mockUpdate.mockReset();
  mockDelete.mockReset();
  mockInsert.mockReset();
  mockSingle.mockReset();
});

// ---------------------------------------------------------------------------
// Phase B — DAL reads
// ---------------------------------------------------------------------------

describe('deriveProjectBudget', () => {
  it('budget = Σ Active version line-items (AC-720, FR-BV-001)', async () => {
    makeRpcBuilder({ data: 4700000, error: null });
    const result = await deriveProjectBudget('p1');
    expect(mockRpc).toHaveBeenCalledWith('get_project_budget', { p_project_id: 'p1' });
    expect(result).toBe(4700000);
  });

  it('sends no org_id to the RPC (AC-720, FR-BV-001)', async () => {
    makeRpcBuilder({ data: 4700000, error: null });
    await deriveProjectBudget('p1');
    const callArgs = mockRpc.mock.calls[0];
    expect(JSON.stringify(callArgs)).not.toContain('org_id');
  });

  it('no Active version => budget 0 (AC-721, FR-BV-002)', async () => {
    makeRpcBuilder({ data: 0, error: null });
    const result = await deriveProjectBudget('p1');
    expect(result).toBe(0);
  });

  it('read-time derivation ignores the stale projects.budget header (AC-722, FR-BV-003)', async () => {
    makeRpcBuilder({ data: 4700000, error: null });
    await deriveProjectBudget('p1');
    // The DAL only calls .rpc('get_project_budget'), never .from('projects')
    expect(mockRpc).toHaveBeenCalledWith('get_project_budget', expect.anything());
    expect(mockFrom).not.toHaveBeenCalled();
    expect(JSON.stringify(mockRpc.mock.calls)).not.toContain('"budget"');
  });

  it('throws on RPC error', async () => {
    makeRpcBuilder({ data: null, error: { message: 'rpc boom' } });
    await expect(deriveProjectBudget('p1')).rejects.toThrow('rpc boom');
  });
});

describe('listBudgetVersions', () => {
  it('lists versions with nested line_items and a numeric total (FR-BV-010 read side)', async () => {
    const versions = [
      {
        id: 'v1',
        org_id: 'org-1',
        project_id: 'p1',
        version: 1,
        name: 'V1',
        status: 'Active' as const,
        created_at: '2026-01-01T00:00:00Z',
        line_items: [
          { id: 'li1', budget_version_id: 'v1', org_id: 'org-1', category: 'Labor' as const, description: null, budgeted_amount: 3000000, actual_amount: 0 },
          { id: 'li2', budget_version_id: 'v1', org_id: 'org-1', category: 'Materials' as const, description: 'steel', budgeted_amount: 1700000, actual_amount: 0 },
        ],
      },
      {
        id: 'v2',
        org_id: 'org-1',
        project_id: 'p1',
        version: 2,
        name: 'V2',
        status: 'Draft' as const,
        created_at: '2026-02-01T00:00:00Z',
        line_items: [],
      },
    ];

    makeFromBuilder({ data: versions, error: null });

    const result = await listBudgetVersions('p1');

    expect(mockFrom).toHaveBeenCalledWith('budget_versions');
    expect(mockSelect).toHaveBeenCalledWith('*, line_items:budget_line_items(*)');
    expect(mockEq).toHaveBeenCalledWith('project_id', 'p1');
    expect(mockOrder).toHaveBeenCalledWith('version', { ascending: true });

    expect(result).toHaveLength(2);
    expect(result[0].total).toBe(4700000);
    expect(result[1].total).toBe(0);
    // numerics are JS numbers
    expect(typeof result[0].total).toBe('number');
    // no org_id sent in the query args
    expect(JSON.stringify(mockEq.mock.calls)).not.toContain('org_id');
  });

  it('coerces string numerics from PostgREST into a number total (guards Number() on budgets.ts:62)', async () => {
    // Postgres numeric arrives over PostgREST as a STRING; the DAL must Number()-coerce it.
    const versions = [
      {
        id: 'v1',
        org_id: 'org-1',
        project_id: 'p1',
        version: 1,
        name: 'V1',
        status: 'Active' as const,
        created_at: '2026-01-01T00:00:00Z',
        line_items: [
          { id: 'li1', budget_version_id: 'v1', org_id: 'org-1', category: 'Labor' as const, description: null, budgeted_amount: '3000000', actual_amount: '0' },
        ],
      },
    ];
    makeFromBuilder({ data: versions, error: null });

    const result = await listBudgetVersions('p1');

    // Numeric (not string concatenation: '03000000' or '03000000') and typed as number.
    expect(result[0].total).toBe(3000000);
    expect(typeof result[0].total).toBe('number');
  });

  it('throws on PostgREST error', async () => {
    makeFromBuilder({ data: null, error: { message: 'list error' } });
    await expect(listBudgetVersions('p1')).rejects.toThrow('list error');
  });
});

// ---------------------------------------------------------------------------
// Phase C — DAL writes + guard
// ---------------------------------------------------------------------------

describe('updateLineItem', () => {
  it('line-item edit rejected when owning version is Active/Archived (AC-723, FR-BV-006/009/011)', async () => {
    makeFromBuilder({
      data: null,
      error: {
        message: 'line-items can only change while the owning version is Draft',
        code: 'P0001',
      },
    });
    await expect(updateLineItem('li1', { budgeted_amount: 500 })).rejects.toThrow(
      'line-items can only change while the owning version is Draft',
    );
  });

  it('calls .from(budget_line_items).update(patch).eq(id)', async () => {
    makeFromBuilder({ data: [{ id: 'li1' }], error: null });
    await updateLineItem('li1', { description: 'updated' });
    expect(mockFrom).toHaveBeenCalledWith('budget_line_items');
    expect(mockUpdate).toHaveBeenCalledWith({ description: 'updated' });
    expect(mockEq).toHaveBeenCalledWith('id', 'li1');
  });
});

describe('createLineItem and deleteLineItem', () => {
  it('line-item create/delete succeed when owning version is Draft (AC-723, FR-BV-010)', async () => {
    makeFromBuilder({ data: [{ id: 'li-new' }], error: null });
    await expect(
      createLineItem('v-draft', { category: 'Labor', description: 'Day labor', budgeted_amount: 200000 }),
    ).resolves.not.toThrow();

    // Reset and test delete
    makeFromBuilder({ data: null, error: null });
    await expect(deleteLineItem('li-new')).resolves.not.toThrow();
  });

  it('createLineItem inserts correct payload without org_id (AC-723, FR-BV-010)', async () => {
    makeFromBuilder({ data: [{ id: 'li-new' }], error: null });
    await createLineItem('v-draft', { category: 'Labor', description: 'Day labor', budgeted_amount: 200000 });
    expect(mockFrom).toHaveBeenCalledWith('budget_line_items');
    const insertCall = mockInsert.mock.calls[0][0];
    expect(insertCall).toMatchObject({
      budget_version_id: 'v-draft',
      category: 'Labor',
      description: 'Day labor',
      budgeted_amount: 200000,
    });
    expect(insertCall).not.toHaveProperty('org_id');
  });

  it('deleteLineItem calls .delete().eq("id", id)', async () => {
    makeFromBuilder({ data: null, error: null });
    await deleteLineItem('li-abc');
    expect(mockFrom).toHaveBeenCalledWith('budget_line_items');
    expect(mockDelete).toHaveBeenCalled();
    expect(mockEq).toHaveBeenCalledWith('id', 'li-abc');
  });

  it('createLineItem throws on error', async () => {
    makeFromBuilder({ data: null, error: { message: 'insert fail' } });
    await expect(
      createLineItem('v-draft', { category: 'Labor', description: null, budgeted_amount: 100 }),
    ).rejects.toThrow('insert fail');
  });

  it('deleteLineItem throws on error', async () => {
    makeFromBuilder({ data: null, error: { message: 'delete fail' } });
    await expect(deleteLineItem('li-bad')).rejects.toThrow('delete fail');
  });
});

describe('createBudgetVersion', () => {
  it('new version is Draft with version = max+1 (AC-724, FR-BV-004)', async () => {
    // First call: read max version → returns [{version: 2}]
    // Second call: insert → returns the new row
    let callCount = 0;
    const newRow = {
      id: 'v-new',
      project_id: 'p1',
      version: 3,
      name: 'V3',
      status: 'Draft' as const,
      org_id: 'org-1',
      created_at: '2026-03-01T00:00:00Z',
    };

    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // read max version
        const b: Record<string, unknown> = {};
        b.select = vi.fn().mockReturnValue(b);
        b.eq = vi.fn().mockReturnValue(b);
        b.order = vi.fn().mockReturnValue(b);
        b.limit = vi.fn().mockReturnValue(b);
        b.then = (resolve: (v: { data: { version: number }[]; error: null }) => void) =>
          Promise.resolve({ data: [{ version: 2 }], error: null }).then(resolve);
        return b;
      } else {
        // insert new version
        const b: Record<string, unknown> = {};
        b.insert = vi.fn().mockReturnValue(b);
        b.select = vi.fn().mockReturnValue(b);
        b.single = vi.fn().mockReturnValue(b);
        b.then = (resolve: (v: { data: typeof newRow; error: null }) => void) =>
          Promise.resolve({ data: newRow, error: null }).then(resolve);
        return b;
      }
    });

    const result = await createBudgetVersion('p1', 'V3');
    expect(result).toMatchObject({ id: 'v-new', version: 3, status: 'Draft' });
  });

  it('inserts Draft status and no org_id (AC-724, FR-BV-004)', async () => {
    let callCount = 0;
    const newRow = { id: 'v-new', project_id: 'p1', version: 1, name: 'V1', status: 'Draft' as const, org_id: 'org-1', created_at: '' };

    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        const b: Record<string, unknown> = {};
        const mockSel = vi.fn().mockReturnValue(b);
        const mockEqLocal = vi.fn().mockReturnValue(b);
        const mockOrd = vi.fn().mockReturnValue(b);
        const mockLim = vi.fn().mockReturnValue(b);
        b.select = mockSel;
        b.eq = mockEqLocal;
        b.order = mockOrd;
        b.limit = mockLim;
        b.then = (resolve: (v: { data: never[]; error: null }) => void) =>
          Promise.resolve({ data: [], error: null }).then(resolve);
        return b;
      } else {
        const b: Record<string, unknown> = {};
        const mockIns = vi.fn().mockReturnValue(b);
        b.insert = mockIns;
        b.select = vi.fn().mockReturnValue(b);
        b.single = vi.fn().mockReturnValue(b);
        b.then = (resolve: (v: { data: typeof newRow; error: null }) => void) =>
          Promise.resolve({ data: newRow, error: null }).then(resolve);
        // capture the insert payload
        (b as { _insertFn: typeof mockIns })._insertFn = mockIns;
        return b;
      }
    });

    await createBudgetVersion('p1', 'V1');
    // Verify the second call to mockFrom was 'budget_versions'
    expect(mockFrom).toHaveBeenCalledWith('budget_versions');
  });

  it('throws on error', async () => {
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      const b: Record<string, unknown> = {};
      b.select = vi.fn().mockReturnValue(b);
      b.eq = vi.fn().mockReturnValue(b);
      b.order = vi.fn().mockReturnValue(b);
      b.limit = vi.fn().mockReturnValue(b);
      b.insert = vi.fn().mockReturnValue(b);
      b.single = vi.fn().mockReturnValue(b);
      if (callCount === 1) {
        b.then = (resolve: (v: { data: never[]; error: null }) => void) =>
          Promise.resolve({ data: [], error: null }).then(resolve);
      } else {
        b.then = (resolve: (v: { data: null; error: { message: string } }) => void) =>
          Promise.resolve({ data: null, error: { message: 'insert error' } }).then(resolve);
      }
      return b;
    });
    await expect(createBudgetVersion('p1', 'V1')).rejects.toThrow('insert error');
  });
});

describe('cloneVersion', () => {
  it('clone creates a new Draft copying line-items, actual_amount reset (AC-725, FR-BV-007)', async () => {
    makeRpcBuilder({ data: 'new-id', error: null });
    const result = await cloneVersion('v-active');
    expect(mockRpc).toHaveBeenCalledWith('clone_budget_version', { version_id: 'v-active' });
    expect(result).toBe('new-id');
  });

  it('sends no org_id (AC-725, FR-BV-007)', async () => {
    makeRpcBuilder({ data: 'new-id', error: null });
    await cloneVersion('v-active');
    expect(JSON.stringify(mockRpc.mock.calls)).not.toContain('org_id');
  });

  it('throws on RPC error', async () => {
    makeRpcBuilder({ data: null, error: { message: 'clone error' } });
    await expect(cloneVersion('v-active')).rejects.toThrow('clone error');
  });
});

describe('activateVersion', () => {
  it('activateVersion calls the activate RPC with version_id, no org_id (FR-BV-005)', async () => {
    makeRpcBuilder({ data: null, error: null });
    await activateVersion('v-draft');
    expect(mockRpc).toHaveBeenCalledWith('activate_budget_version', { version_id: 'v-draft' });
    expect(JSON.stringify(mockRpc.mock.calls)).not.toContain('org_id');
  });

  it('throws on RPC error', async () => {
    makeRpcBuilder({ data: null, error: { message: 'activate error' } });
    await expect(activateVersion('v-draft')).rejects.toThrow('activate error');
  });
});

describe('archiveVersion', () => {
  it('archiveVersion sets status Archived via update (FR-BV-008)', async () => {
    makeFromBuilder({ data: [{ id: 'v1', status: 'Archived' }], error: null });
    await archiveVersion('v1');
    expect(mockFrom).toHaveBeenCalledWith('budget_versions');
    expect(mockUpdate).toHaveBeenCalledWith({ status: 'Archived' });
    expect(mockEq).toHaveBeenCalledWith('id', 'v1');
  });

  it('sends no org_id (FR-BV-008)', async () => {
    makeFromBuilder({ data: [{ id: 'v1' }], error: null });
    await archiveVersion('v1');
    expect(JSON.stringify(mockUpdate.mock.calls)).not.toContain('org_id');
  });

  it('throws on error', async () => {
    makeFromBuilder({ data: null, error: { message: 'archive fail' } });
    await expect(archiveVersion('v1')).rejects.toThrow('archive fail');
  });
});

describe('deleteDraftVersion', () => {
  it('deleteDraftVersion deletes the version row (OD-BUDGET-C)', async () => {
    makeFromBuilder({ data: null, error: null });
    await deleteDraftVersion('v-draft');
    expect(mockFrom).toHaveBeenCalledWith('budget_versions');
    expect(mockDelete).toHaveBeenCalled();
    expect(mockEq).toHaveBeenCalledWith('id', 'v-draft');
  });

  it('sends no org_id (OD-BUDGET-C)', async () => {
    makeFromBuilder({ data: null, error: null });
    await deleteDraftVersion('v-draft');
    expect(JSON.stringify(mockDelete.mock.calls)).not.toContain('org_id');
  });

  it('throws on error', async () => {
    makeFromBuilder({ data: null, error: { message: 'delete version fail' } });
    await expect(deleteDraftVersion('v-draft')).rejects.toThrow('delete version fail');
  });
});
