import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted mock setup — mirrors procurements.test.ts builder pattern,
// extended to cover both .from() chains AND .rpc() calls.
// ---------------------------------------------------------------------------

const {
  mockRpc,
  mockFrom,
  mockSelect,
  mockEq,
  mockIn,
  mockIs,
  mockNeq,
  mockOrder,
  mockLimit,
  mockUpdate,
  mockDelete,
  mockInsert,
  mockSingle,
  mockMaybeSingle,
  mockFunctionsInvoke,
} = vi.hoisted(() => {
  const mockRpc = vi.fn();
  const mockFrom = vi.fn();
  const mockSelect = vi.fn();
  const mockEq = vi.fn();
  const mockIn = vi.fn();
  const mockIs = vi.fn();
  const mockNeq = vi.fn();
  const mockOrder = vi.fn();
  const mockLimit = vi.fn();
  const mockUpdate = vi.fn();
  const mockDelete = vi.fn();
  const mockInsert = vi.fn();
  const mockSingle = vi.fn();
  const mockMaybeSingle = vi.fn();
  const mockFunctionsInvoke = vi.fn();
  return {
    mockRpc,
    mockFrom,
    mockSelect,
    mockEq,
    mockIn,
    mockIs,
    mockNeq,
    mockOrder,
    mockLimit,
    mockUpdate,
    mockDelete,
    mockInsert,
    mockSingle,
    mockMaybeSingle,
    mockFunctionsInvoke,
  };
});

// P3c (slice 4): `activateVersion` now also re-reads `activated_at` (`.maybeSingle()`) and dispatches the
// push consequence (`supabase.functions.invoke`) — both mocked here so the invariant tests below can wire
// the FULL success/failure paths, not just the RPC half.
vi.mock('@/src/lib/supabase/client', () => ({
  supabase: { from: mockFrom, rpc: mockRpc, functions: { invoke: mockFunctionsInvoke } },
}));

import {
  deriveProjectBudget,
  importBudgetLine,
  getBudgetActivationMode,
  precheckBudgetActivation,
  listBudgetVersions,
  createLineItem,
  updateLineItem,
  deleteLineItem,
  createBudgetVersion,
  cloneVersion,
  activateVersion,
  retryBudgetPush,
  archiveVersion,
  listBudgetArchiveLiveTargets,
  listLegacyBudgetArchiveLiveTargets,
  listBudgetArchiveTargets,
  deleteDraftVersion,
  listBudgetDocumentLinks,
  addBudgetDocumentLink,
  removeBudgetDocumentLink,
  getBudgetDistribution,
  saveBudgetDistribution,
  switchBudgetDraftMode,
  returnVersion,
  resubmitVersion,
  type BudgetDistributionPlan,
} from './budgets';
import { AppError } from '@/src/lib/appError';

// ---------------------------------------------------------------------------
// Builder helpers
// ---------------------------------------------------------------------------

/** Creates a chainable builder that resolves to `resolved` at .then() time. */
function makeRpcBuilder(resolved: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {
    then: (resolve: (v: typeof resolved) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(resolved).then(resolve, reject),
  };
  builder.order = vi.fn().mockReturnValue(builder);
  builder.range = vi.fn().mockReturnValue(builder);
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
  builder.in = mockIn.mockReturnValue(builder);
  builder.is = mockIs.mockReturnValue(builder);
  builder.neq = mockNeq.mockReturnValue(builder);
  builder.order = mockOrder.mockReturnValue(builder);
  builder.limit = mockLimit.mockReturnValue(builder);
  builder.range = vi.fn().mockReturnValue(builder);
  builder.update = mockUpdate.mockReturnValue(builder);
  builder.delete = mockDelete.mockReturnValue(builder);
  builder.insert = mockInsert.mockReturnValue(builder);
  builder.single = mockSingle.mockReturnValue(builder);
  builder.maybeSingle = mockMaybeSingle.mockReturnValue(builder);
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
  mockIn.mockReset();
  mockIs.mockReset();
  mockNeq.mockReset();
  mockOrder.mockReset();
  mockLimit.mockReset();
  mockUpdate.mockReset();
  mockDelete.mockReset();
  mockInsert.mockReset();
  mockSingle.mockReset();
  mockMaybeSingle.mockReset();
  mockFunctionsInvoke.mockReset();
});

describe('AC-M365DOC-052 typed budget document links', () => {
  const reference = {
    drive_id: 'synthetic-drive', item_id: 'synthetic-item',
    web_url: 'https://example.invalid/item', name: 'Synthetic item', item_kind: 'file' as const,
  };

  it('lists evidence for exactly one version in deterministic link-time/id order', async () => {
    const row = { id: 'link-1', budget_version_id: 'version-1' };
    makeFromBuilder({ data: [row], error: null });
    await expect(listBudgetDocumentLinks('version-1')).resolves.toEqual([row]);
    expect(mockFrom).toHaveBeenCalledWith('budget_version_document_links');
    expect(mockEq).toHaveBeenCalledWith('budget_version_id', 'version-1');
    expect(mockOrder).toHaveBeenNthCalledWith(1, 'ms_linked_at');
    expect(mockOrder).toHaveBeenNthCalledWith(2, 'id');
  });

  it('adds one typed reference and removes only its link row', async () => {
    const row = { id: 'link-1', budget_version_id: 'version-1' };
    makeFromBuilder({ data: row, error: null });
    await expect(addBudgetDocumentLink('version-1', reference)).resolves.toEqual(row);
    expect(mockInsert).toHaveBeenCalledWith({
      budget_version_id: 'version-1', ms_drive_id: reference.drive_id, ms_item_id: reference.item_id,
      ms_web_url: reference.web_url, ms_item_name: reference.name, ms_item_kind: 'file',
    });
    makeFromBuilder({ data: [{ id: 'link-1' }], error: null });
    await removeBudgetDocumentLink('link-1');
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockEq).toHaveBeenCalledWith('id', 'link-1');
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockFunctionsInvoke).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Phase B — DAL reads
// ---------------------------------------------------------------------------

describe('getBudgetActivationMode', () => {
  it('calls the activation-mode RPC with the version id and returns its mode', async () => {
    makeRpcBuilder({ data: 'sole_operator', error: null });
    await expect(getBudgetActivationMode('version-1')).resolves.toBe('sole_operator');
    expect(mockRpc).toHaveBeenCalledWith('budget_activation_mode', { version_id: 'version-1' });
  });

  it('maps RPC errors through the shared AppError pattern', async () => {
    makeRpcBuilder({ data: null, error: { message: 'denied', code: '42501' } });
    await expect(getBudgetActivationMode('version-1')).rejects.toMatchObject({
      message: 'denied', code: '42501',
    });
    await expect(getBudgetActivationMode('version-1')).rejects.toBeInstanceOf(AppError);
  });

  it('rejects an unexpected mode returned by the RPC', async () => {
    makeRpcBuilder({ data: 'unknown', error: null });
    await expect(getBudgetActivationMode('version-1')).rejects.toThrow('Unexpected budget activation mode');
  });
});

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
  // The read contract is ONE aggregate invoker RPC. These tests keep every behavioural oracle of the
  // previous four-request path (complete set, ordering, editor grouping, numeric coercion, error
  // propagation, no client-supplied org scope) while pinning the new single-request call shape.
  const aggregate = (over: Record<string, unknown>) => ({
    version_no: 1, version_id: 'v1', version_row: {}, line_items: [], editor_ids: [], total: 0, ...over,
  });

  it('lists versions with nested line_items and a numeric total (FR-BV-010 read side)', async () => {
    const v1 = {
      id: 'v1', org_id: 'org-1', project_id: 'p1', version: 1, name: 'V1',
      status: 'Active' as const, created_at: '2026-01-01T00:00:00Z', currency: 'USD',
    };
    const v2 = {
      id: 'v2', org_id: 'org-1', project_id: 'p1', version: 2, name: 'V2',
      status: 'Draft' as const, created_at: '2026-02-01T00:00:00Z', currency: 'USD',
    };
    makeRpcBuilder({
      data: [
        aggregate({
          version_no: 1, version_id: 'v1', version_row: v1, total: 4700000,
          line_items: [
            { id: 'li1', budget_version_id: 'v1', org_id: 'org-1', category: 'Labor' as const, description: null, budgeted_amount: 3000000, actual_amount: 0 },
            { id: 'li2', budget_version_id: 'v1', org_id: 'org-1', category: 'Materials' as const, description: 'steel', budgeted_amount: 1700000, actual_amount: 0 },
          ],
        }),
        aggregate({ version_no: 2, version_id: 'v2', version_row: v2, total: 0 }),
      ],
      error: null,
    });

    const result = await listBudgetVersions('p1');

    expect(mockRpc).toHaveBeenCalledWith('budget_version_read', { p_project_id: 'p1', p_offset: 0, p_limit: 1000 });
    expect(mockFrom).not.toHaveBeenCalled();
    expect(result).toHaveLength(2);
    expect(result[0].total).toBe(4700000);
    expect(result[1].total).toBe(0);
    expect(result[0].line_items.map((li) => li.id)).toEqual(['li1', 'li2']);
    expect(result.map((version) => version.editor_ids)).toEqual([[], []]);
    // numerics are JS numbers
    expect(typeof result[0].total).toBe('number');
    // no org_id sent in the read args
    expect(JSON.stringify(mockRpc.mock.calls)).not.toContain('org_id');
  });

  it('coerces string numerics from PostgREST into a number total (guards the Number() conversion)', async () => {
    // Postgres numeric may arrive over PostgREST as a STRING; the DAL must Number()-coerce it.
    makeRpcBuilder({
      data: [aggregate({
        version_row: { id: 'v1', org_id: 'org-1', project_id: 'p1', version: 1, name: 'V1', status: 'Active', created_at: '2026-01-01T00:00:00Z' },
        line_items: [{ id: 'li1', budget_version_id: 'v1', org_id: 'org-1', category: 'Labor', description: null, budgeted_amount: '3000000', actual_amount: '0' }],
        total: '3000000',
      })],
      error: null,
    });

    const result = await listBudgetVersions('p1');

    // Numeric (not string concatenation) and typed as number.
    expect(result[0].total).toBe(3000000);
    expect(typeof result[0].total).toBe('number');
  });

  it('throws on PostgREST error', async () => {
    makeRpcBuilder({ data: null, error: { message: 'list error' } });
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
    makeFromBuilder({ data: [{ id: 'li-new' }], error: null });
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
    makeFromBuilder({ data: [{ id: 'li-abc' }], error: null });
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

describe('version allocation under contention', () => {
  it('re-reads the maximum after a project-version collision', async () => {
    const conflict = { code: '23505', message: 'duplicate key value violates unique constraint "budget_versions_project_id_version_key"' };
    const result = { id: 'created', version: 3 };
    let read = 0;
    const inserted: number[] = [];
    mockFrom.mockImplementation(() => {
      const b: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'order', 'limit', 'single']) b[method] = () => b;
      let isInsert = false;
      b.insert = (row: { version: number }) => { isInsert = true; inserted.push(row.version); return b; };
      b.then = (resolve: (value: unknown) => void) => Promise.resolve(!isInsert
        ? { data: [{ version: ++read }], error: null }
        : inserted.length === 1 ? { data: null, error: conflict } : { data: result, error: null }).then(resolve);
      return b;
    });
    await expect(createBudgetVersion('p1', 'Draft')).resolves.toEqual(result);
    expect(inserted).toEqual([2, 3]);
  });

  it('does not retry a different unique constraint', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "budget_versions_import_key_uidx"' } });
    await expect(cloneVersion('source')).rejects.toMatchObject({ code: '23505' });
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it('stops retrying persistent version collisions and preserves the error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "budget_versions_project_id_version_key"' } });
    await expect(cloneVersion('source')).rejects.toMatchObject({ code: '23505' });
    expect(mockRpc).toHaveBeenCalledTimes(4);
  });

  it('retries a clone when another allocation wins its version', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "budget_versions_project_id_version_key"' } });
    mockRpc.mockResolvedValueOnce({ data: 'copy', error: null });
    await expect(cloneVersion('source')).resolves.toBe('copy');
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
  /** ADR-0062: activation resolves `queued` on the PMO write; the push outcome arrives via `onPushSettled`. */
  async function activateAndSettle(id: string) {
    let settled!: (s: string) => void;
    const outcome = new Promise<string>((r) => (settled = r));
    const result = await activateVersion(id, settled);
    return { result, outcome: await outcome };
  }

  it('activateVersion calls the activate RPC with version_id, no org_id (FR-BV-005)', async () => {
    makeRpcBuilder({ data: null, error: null });
    makeFromBuilder({ data: { activated_at: '2026-07-16T10:00:00Z' }, error: null });
    mockFunctionsInvoke.mockResolvedValue({ data: { externalRecordId: null, canonical: { id: 'v-draft' } }, error: null });
    await activateVersion('v-draft');
    expect(mockRpc).toHaveBeenCalledWith('activate_budget_version', { version_id: 'v-draft' });
    expect(JSON.stringify(mockRpc.mock.calls)).not.toContain('org_id');
  });

  it('throws on RPC error', async () => {
    makeRpcBuilder({ data: null, error: { message: 'activate error' } });
    await expect(activateVersion('v-draft')).rejects.toThrow('activate error');
  });

  it('AC-BUD-032 ⚑ the money invariant: activation still succeeds when the ERP push dispatch fails', async () => {
    makeRpcBuilder({ data: null, error: null });
    makeFromBuilder({ data: { activated_at: '2026-07-16T10:00:00Z' }, error: null });
    mockFunctionsInvoke.mockResolvedValue({ data: null, error: { message: 'external-unreachable' } });
    // Never rejects — the push failure is swallowed into durable server-side state, never re-thrown here.
    // HIGH-C: but it is REPORTED. A dispatch that never reached the edge function leaves NO mirror row
    // at all (every mirror writer lives inside `adapter-dispatch`), so the sweep backstop — whose work
    // queue IS that mirror — is structurally blind to it. Returning `void` made the UI show a plain
    // success while ERPNext kept enforcing the previous budget indefinitely.
    const { result, outcome } = await activateAndSettle('v-draft');
    expect(result).toEqual({ pushState: 'queued' });
    expect(outcome).toBe('failed');
  });

  it('HIGH-C a SUCCESSFUL push is reported as such', async () => {
    makeRpcBuilder({ data: null, error: null });
    makeFromBuilder({ data: { activated_at: '2026-07-16T10:00:00Z' }, error: null });
    mockFunctionsInvoke.mockResolvedValue({ data: { externalRecordId: 'BUDGET-2026-00001', canonical: { id: 'v-draft' } }, error: null });
    const { result, outcome } = await activateAndSettle('v-draft');
    expect(result).toEqual({ pushState: 'queued' });
    expect(outcome).toBe('pushed');
  });

  it('AC-BUD-032 activation still succeeds when the version carries no activation stamp to key the push on', async () => {
    makeRpcBuilder({ data: null, error: null });
    makeFromBuilder({ data: { activated_at: null }, error: null }); // budgetPushKey fails closed on this
    const { result, outcome } = await activateAndSettle('v-draft');
    expect(result).toEqual({ pushState: 'queued' });
    expect(outcome).toBe('failed');
    expect(mockFunctionsInvoke).not.toHaveBeenCalled();
  });

  it('AC-BFY-009 HIGH-D retryBudgetPush sends NO client key — the server derives one per fiscal year', async () => {
    makeFromBuilder({ data: { activated_at: '2026-07-16T10:00:00Z' }, error: null });
    mockFunctionsInvoke.mockResolvedValue({
      data: { externalRecordId: null, canonical: { id: 'v-1' }, years: [{ fiscal_year: '2026', pushed: true }] },
      error: null,
    });
    await expect(retryBudgetPush('v-1', '2026')).resolves.toEqual({ pushState: 'pushed' });
    expect(mockRpc).not.toHaveBeenCalled(); // ⚑ a retry NEVER re-activates — the version is already Active
    const body = mockFunctionsInvoke.mock.calls[0][1].body;
    // ⚑ HIGH 5 (FR-BFY-056): the retried year is sent as a real dispatch TARGET, so the server drives
    // ONLY that plan year — not the whole fan-out.
    expect(body).toMatchObject({ domain: 'budget', operation: 'create', record: { id: 'v-1', erp_doc_kind: 'budget', target_fiscal_year: '2026' } });
    // ⚑ FR-BFY-031: the client CANNOT mint the key — it does not know the years (the calendar is a
    // live ERP read only the server-side gate makes). A client key here would key year 2's command on
    // year 1's string and silently suppress it.
    expect(body).not.toHaveProperty('idempotencyKey');
  });

  it('AC-BFY-009 the retry reports the outcome of the YEAR the operator retried, not the fan-out as a whole', async () => {
    makeFromBuilder({ data: { activated_at: '2026-07-16T10:00:00Z' }, error: null });
    // The server re-drove both years: FY2026 reconciled to its existing (already confirmed) push,
    // FY2027 — the one the operator retried — did not land.
    mockFunctionsInvoke.mockResolvedValue({
      data: {
        externalRecordId: null,
        canonical: { id: 'v-1' },
        years: [{ fiscal_year: '2026', pushed: true }, { fiscal_year: '2027', pushed: false }],
      },
      error: null,
    });
    await expect(retryBudgetPush('v-1', '2027')).resolves.toEqual({ pushState: 'failed' });
    await expect(retryBudgetPush('v-1', '2026')).resolves.toEqual({ pushState: 'pushed' });
  });

  it('AC-BFY-009 a YEAR-LESS retry (nothing on record for any year) reports the whole fan-out', async () => {
    makeFromBuilder({ data: { activated_at: '2026-07-16T10:00:00Z' }, error: null });
    mockFunctionsInvoke.mockResolvedValue({
      data: { canonical: { id: 'v-1' }, years: [{ fiscal_year: '2026', pushed: true }, { fiscal_year: '2027', pushed: false }] },
      error: null,
    });
    // Anything less than EVERY year landing is not "pushed" — the project still has a year ERPNext
    // enforces nothing for.
    await expect(retryBudgetPush('v-1', null)).resolves.toEqual({ pushState: 'failed' });
    // ⚑ HIGH 5 (FR-BFY-056): a year-less retry carries NO target — it is the whole-fan-out op, so the
    // server must not receive a target year to narrow it.
    expect(mockFunctionsInvoke.mock.calls[0][1].body.record).not.toHaveProperty('target_fiscal_year');
  });

  /**
   * ⚑ SHOULD-FIX (FU-2 round 2) — NOTHING WAS PUSHED, AND THE TOAST SAID "PUSHED".
   *
   * A multi-FY version with NO line items produces an EMPTY push plan: the fan-out loop body never
   * runs, no ERP `Budget` is created, no mirror row is written — and the boundary answers `200` with
   * `{ years: [] }`. Reading that as success told the operator "ERPNext is now enforcing the active
   * budget" about a push that did not happen, while the per-year banner underneath said `never-pushed`:
   * two contradictory statements instead of one honest one.
   *
   * An EMPTY `years` array is not an absent one. Absent = a pre-BFY server that did not report years
   * (taken at face value: it resolved, so the year asked about is the year that pushed). Empty = this
   * server enumerated the years it attempted and there were NONE.
   */
  it('AC-BFY-009 an EMPTY years array is reported as nothing-to-push — never as a push that happened', async () => {
    makeFromBuilder({ data: { activated_at: '2026-07-16T10:00:00Z' }, error: null });
    mockFunctionsInvoke.mockResolvedValue({ data: { years: [] }, error: null });
    await expect(retryBudgetPush('v-1', '2026')).resolves.toEqual({ pushState: 'nothing-to-push' });
    await expect(retryBudgetPush('v-1', null)).resolves.toEqual({ pushState: 'nothing-to-push' });
  });

  it('AC-BFY-009 an ABSENT years key is still taken at face value — a pre-BFY server is unaffected', async () => {
    makeFromBuilder({ data: { activated_at: '2026-07-16T10:00:00Z' }, error: null });
    mockFunctionsInvoke.mockResolvedValue({ data: { externalRecordId: 'BUDGET-2026-00001', canonical: { id: 'v-1' } }, error: null });
    await expect(retryBudgetPush('v-1', '2026')).resolves.toEqual({ pushState: 'pushed' });
  });

  it('AC-BFY-009 activation reports nothing-to-push too — an activated version with no lines pushed nothing', async () => {
    makeRpcBuilder({ data: null, error: null });
    makeFromBuilder({ data: { activated_at: '2026-07-16T10:00:00Z' }, error: null });
    mockFunctionsInvoke.mockResolvedValue({ data: { years: [] }, error: null });
    const { result, outcome } = await activateAndSettle('v-draft');
    expect(result).toEqual({ pushState: 'queued' });
    expect(outcome).toBe('nothing-to-push');
  });

  // ── H-3 (Luna audit round 3): the retry must not report a failure it never made durable. ──────
  it('H-3 a retry of an UNSTAMPED version THROWS the reason (nothing durable was written, so "failed" would be a lie)', async () => {
    makeFromBuilder({ data: { activated_at: null }, error: null });
    // `budgetPushKey` fails closed client-side, BEFORE any dispatch: no request is made, so no mirror
    // row and no notification exist. Swallowing it into `pushState:'failed'` told the operator the push
    // was attempted and recorded — it was neither, and the banner then had no reachable way out.
    await expect(retryBudgetPush('v-unstamped', '2026')).rejects.toThrow(/activation stamp/i);
    expect(mockFunctionsInvoke).not.toHaveBeenCalled();
  });

  it('HIGH-D a retry that fails again REPORTS the failure instead of throwing (the money invariant holds on the retry path too)', async () => {
    makeFromBuilder({ data: { activated_at: '2026-07-16T10:00:00Z' }, error: null });
    mockFunctionsInvoke.mockResolvedValue({ data: null, error: { message: 'budget-category-unmapped' } });
    await expect(retryBudgetPush('v-1', '2026')).resolves.toEqual({ pushState: 'failed' });
  });

  it('AC-BFY-009 activateVersion dispatches ONE bare-UUID create and lets the server fan out per fiscal year', async () => {
    makeRpcBuilder({ data: null, error: null });
    makeFromBuilder({ data: { activated_at: '2026-07-16T10:00:00Z' }, error: null });
    mockFunctionsInvoke.mockResolvedValue({ data: { externalRecordId: null, canonical: { id: 'v-draft' } }, error: null });
    await activateAndSettle('v-draft');
    expect(mockFunctionsInvoke).toHaveBeenCalledTimes(1);
    const body = mockFunctionsInvoke.mock.calls[0][1].body;
    // ⚑ `record.id` is the BARE budget_version_id — the year-qualified identity is derived server-side
    // (the gate query, the mirror FK and the inbound feed all need the bare UUID, spec §5.1).
    expect(body).toMatchObject({
      domain: 'budget',
      operation: 'create',
      record: { id: 'v-draft', erp_doc_kind: 'budget' },
    });
    expect(body).not.toHaveProperty('idempotencyKey');
  });
});

describe('precheckBudgetActivation', () => {
  it('reads activation readiness through the caller-authenticated adapter boundary without a write', async () => {
    const result = {
      status: 'ready',
      erpCheck: 'available',
      fiscalYearNames: ['2026'],
      issues: [],
    };
    mockFunctionsInvoke.mockResolvedValue({ data: result, error: null });

    await expect(precheckBudgetActivation('v-draft')).resolves.toEqual(result);
    expect(mockFunctionsInvoke).toHaveBeenCalledWith('adapter-dispatch', {
      body: { action: 'budget-activation-precheck', versionId: 'v-draft' },
    });
  });

  it('surfaces a failed PMO readiness read rather than treating it as ready', async () => {
    mockFunctionsInvoke.mockResolvedValue({ data: null, error: { message: 'could not read draft' } });
    await expect(precheckBudgetActivation('v-draft')).rejects.toThrow('could not read draft');
  });
});

describe('archiveVersion', () => {
  it('archives through the durable RPC and returns the queued cancellation count', async () => {
    makeRpcBuilder({ data: { cancel_erp: true, live_target_count: 2, intent_ids: ['job-1', 'job-2'] }, error: null });
    await expect(archiveVersion('v1', true)).resolves.toEqual({
      cancelErp: true, liveTargetCount: 2, queuedCount: 2,
    });
    expect(mockRpc).toHaveBeenCalledWith('archive_budget_version_with_cancel_intent', expect.objectContaining({
      p_version_id: 'v1', p_cancel_erp: true,
      p_archive_request_id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
    }));
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('preserves the stored operator decision returned by an idempotent retry', async () => {
    makeRpcBuilder({ data: { cancel_erp: true, live_target_count: 1, intent_ids: ['job-1'] }, error: null });
    await expect(archiveVersion('v1', false)).resolves.toMatchObject({ cancelErp: true, queuedCount: 1 });
  });

  it('throws on a failed archive RPC', async () => {
    makeRpcBuilder({ data: null, error: { message: 'archive fail', code: '42501' } });
    await expect(archiveVersion('v1', true)).rejects.toThrow('archive fail');
  });
});

describe('listBudgetArchiveLiveTargets', () => {
  function configureArchiveTargets(binding: { version_major: number; activated_at: string | null }, rows: unknown[]) {
    const targetBuilder = makeFromBuilder({ data: rows.map((row) => ({ to_fiscal_year: null, ...(row as object) })), error: null });
    const bindingBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: binding, error: null }),
    };
    mockFrom.mockImplementation((table: string) => table === 'external_org_bindings' ? bindingBuilder : targetBuilder);
  }

  it('reads live v16 account budgets for the supplied versions', async () => {
    configureArchiveTargets({ version_major: 16, activated_at: '2026-01-01T00:00:00Z' }, [
      { id: 'm1', budget_version_id: 'v1', fiscal_year: '2026', erp_account: '5100', erp_budget_name: 'BUD-1', erp_docstatus: 1, erp_cancelled_at: null, push_state: 'pushed', budget_intent: 'ensure', activated_at_witness: '2026-01-01T00:00:00Z' },
      { id: 'm2', budget_version_id: 'v1', fiscal_year: '2027', erp_account: '5200', erp_budget_name: null, erp_docstatus: null, erp_cancelled_at: null, push_state: 'failed', budget_intent: 'ensure' },
      { id: 'm3', budget_version_id: 'v1', fiscal_year: '2028', erp_account: '5300', erp_budget_name: 'BUD-3', erp_docstatus: 2, erp_cancelled_at: null, push_state: 'pushed', budget_intent: 'ensure' },
      { id: 'm4', budget_version_id: 'v2', fiscal_year: '2026', erp_account: '5400', erp_budget_name: 'BUD-4', erp_docstatus: 1, erp_cancelled_at: null, push_state: 'pushed', budget_intent: 'ensure', activated_at_witness: '2026-01-01T00:00:00Z' },
      { id: 'm5', budget_version_id: 'v1', fiscal_year: '2026', erp_account: '5500', erp_budget_name: 'BUD-5', erp_docstatus: 1, erp_cancelled_at: null, push_state: 'pending', budget_intent: 'remove', activated_at_witness: '2026-01-01T00:00:00Z' },
    ]);
    const targets = await listBudgetArchiveLiveTargets(['v1', 'v2']);
    expect(targets.map((row) => row.id)).toEqual(['m1', 'm4', 'm5']);
    expect(targets.every((row) => row.archive_cancellation_available)).toBe(true);
    expect(mockFrom).toHaveBeenCalledWith('budget_push_mirror_rows');
    expect(mockFrom).toHaveBeenCalledWith('external_org_bindings');
    expect(mockSelect).toHaveBeenCalledWith('id,budget_version_id,fiscal_year,to_fiscal_year,erp_account,erp_budget_name,erp_docstatus,erp_cancelled_at,push_state,budget_intent,activated_at_witness');
    expect(mockIn).toHaveBeenCalledWith('budget_version_id', ['v1', 'v2']);
    expect(mockIs).toHaveBeenCalledWith('erp_cancelled_at', null);
    expect(mockNeq).toHaveBeenCalledWith('erp_account', '');
  });

  it('keeps live targets visible for the action-required banner when v16 cancellation is unavailable', async () => {
    configureArchiveTargets({ version_major: 16, activated_at: null }, [
      { id: 'm1', budget_version_id: 'v1', fiscal_year: '2026', erp_account: '5100', erp_budget_name: 'BUD-1', erp_docstatus: 1, erp_cancelled_at: null, push_state: 'pushed', budget_intent: 'ensure', activated_at_witness: '2026-01-01T00:00:00Z' },
    ]);

    const targets = await listBudgetArchiveLiveTargets(['v1']);

    expect(targets).toHaveLength(1);
    expect(targets[0].archive_cancellation_available).toBe(false);
  });

  it('enables archive cancellation only for an active ERPNext v16 binding', async () => {
    configureArchiveTargets({ version_major: 15, activated_at: '2026-01-01T00:00:00Z' }, [
      { id: 'm1', budget_version_id: 'v1', fiscal_year: '2026', erp_account: '5100', erp_budget_name: 'BUD-1', erp_docstatus: 1, erp_cancelled_at: null, push_state: 'pushed', budget_intent: 'ensure', activated_at_witness: '2026-01-01T00:00:00Z' },
    ]);

    const targets = await listBudgetArchiveLiveTargets(['v1']);

    expect(targets).toHaveLength(1);
    expect(targets[0].archive_cancellation_available).toBe(false);
  });

  it('does not query when there are no versions', async () => {
    await expect(listBudgetArchiveLiveTargets([])).resolves.toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('deleteDraftVersion', () => {
  it('deleteDraftVersion deletes the version row (OD-BUDGET-C)', async () => {
    makeFromBuilder({ data: [{ id: 'v-draft' }], error: null });
    await deleteDraftVersion('v-draft');
    expect(mockFrom).toHaveBeenCalledWith('budget_versions');
    expect(mockDelete).toHaveBeenCalled();
    expect(mockEq).toHaveBeenCalledWith('id', 'v-draft');
  });

  it('sends no org_id (OD-BUDGET-C)', async () => {
    makeFromBuilder({ data: [{ id: 'v-draft' }], error: null });
    await deleteDraftVersion('v-draft');
    expect(JSON.stringify(mockDelete.mock.calls)).not.toContain('org_id');
  });

  it('throws on error', async () => {
    makeFromBuilder({ data: null, error: { message: 'delete version fail' } });
    await expect(deleteDraftVersion('v-draft')).rejects.toThrow('delete version fail');
  });
});

// ---------------------------------------------------------------------------
// AC-W3-F6 — Budget DAL must preserve Postgres error codes (AppError)
// ---------------------------------------------------------------------------

describe('AC-W3-F6: budget DAL throws AppError preserving the Postgres error code', () => {
  it('deriveProjectBudget rejects with AppError carrying the original code', async () => {
    makeRpcBuilder({ data: null, error: { message: 'permission denied', code: '42501' } });
    const err = await deriveProjectBudget('p1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('42501');
  });

  it('listBudgetVersions rejects with AppError carrying the original code', async () => {
    makeRpcBuilder({ data: null, error: { message: 'illegal state', code: 'P0001' } });
    const err = await listBudgetVersions('p1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('P0001');
  });

  it('createLineItem rejects with AppError carrying the original code', async () => {
    makeFromBuilder({ data: null, error: { message: 'duplicate', code: '23505' } });
    const err = await createLineItem('v1', { category: 'Labor', description: null, budgeted_amount: 100 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('23505');
  });

  it('updateLineItem rejects with AppError carrying the original code', async () => {
    makeFromBuilder({ data: null, error: { message: 'version not Draft', code: 'P0001' } });
    const err = await updateLineItem('li1', { budgeted_amount: 500 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('P0001');
  });

  it('deleteLineItem rejects with AppError carrying the original code', async () => {
    makeFromBuilder({ data: null, error: { message: 'version not Draft', code: 'P0001' } });
    const err = await deleteLineItem('li1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('P0001');
  });

  it('activateVersion rejects with AppError carrying the original code', async () => {
    makeRpcBuilder({ data: null, error: { message: 'already active', code: 'P0001' } });
    const err = await activateVersion('v1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('P0001');
  });

  it('cloneVersion rejects with AppError carrying the original code', async () => {
    makeRpcBuilder({ data: null, error: { message: 'not found', code: '23503' } });
    const err = await cloneVersion('v1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('23503');
  });

  it('archiveVersion rejects with AppError carrying the original code', async () => {
    makeRpcBuilder({ data: null, error: { message: 'rls denied', code: '42501' } });
    const err = await archiveVersion('v1', true).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('42501');
  });

  it('deleteDraftVersion rejects with AppError carrying the original code', async () => {
    makeFromBuilder({ data: null, error: { message: 'non-draft', code: 'P0001' } });
    const err = await deleteDraftVersion('v-draft').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('P0001');
  });
});

// ---------------------------------------------------------------------------
// #541 — the silent-no-op class on the BUDGET money path. An RLS `using` denial HIDES the row, so
// the UPDATE/DELETE touches 0 rows and returns `error === null`: the DAL used to resolve and the UI
// toasted "Saved". Two-sided per call site — a positive control that must resolve, and a denial
// that must REJECT with 42501 *and* prove the write was actually attempted ("nothing threw" is not
// evidence when a `using` denial throws nothing).
// ---------------------------------------------------------------------------

describe('#541 budget writes reject a using-denied 0-row no-op', () => {
  it('#541: updateLineItem resolves when the row comes back (positive control)', async () => {
    makeFromBuilder({ data: [{ id: 'li1' }], error: null });
    await expect(updateLineItem('li1', { budgeted_amount: 500 })).resolves.toBeUndefined();
  });

  it('#541: updateLineItem rejects 42501 when 0 rows matched and no error was reported', async () => {
    makeFromBuilder({ data: [], error: null });
    const err = await updateLineItem('li1', { budgeted_amount: 500 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('42501');
    expect(mockUpdate).toHaveBeenCalled();
  });

  it('#541: deleteLineItem resolves when the row comes back (positive control)', async () => {
    makeFromBuilder({ data: [{ id: 'li1' }], error: null });
    await expect(deleteLineItem('li1')).resolves.toBeUndefined();
  });

  it('#541: deleteLineItem rejects 42501 when 0 rows matched and no error was reported', async () => {
    makeFromBuilder({ data: [], error: null });
    const err = await deleteLineItem('li1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('42501');
    expect(mockDelete).toHaveBeenCalled();
  });

  it('#541: archiveVersion resolves when the row comes back (positive control)', async () => {
    makeRpcBuilder({ data: { cancel_erp: false, live_target_count: 0, intent_ids: [] }, error: null });
    await expect(archiveVersion('v1', false)).resolves.toMatchObject({ cancelErp: false, queuedCount: 0 });
  });

  it('#541: archiveVersion rejects 42501 when 0 rows matched and no error was reported', async () => {
    makeRpcBuilder({ data: null, error: { message: 'budget version not found', code: '42501' } });
    const err = await archiveVersion('v1', false).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('42501');
    expect(mockRpc).toHaveBeenCalled();
  });

  it('#541: deleteDraftVersion resolves when the row comes back (positive control)', async () => {
    makeFromBuilder({ data: [{ id: 'v-draft' }], error: null });
    await expect(deleteDraftVersion('v-draft')).resolves.toBeUndefined();
  });

  it('#541: deleteDraftVersion rejects 42501 when 0 rows matched and no error was reported', async () => {
    // The 0177 Admin-only trigger RAISES — that is the OTHER layer. This is the RLS layer, which
    // is silent, and defence in depth needs a check per layer.
    makeFromBuilder({ data: [], error: null });
    const err = await deleteDraftVersion('v-draft').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('42501');
    expect(mockDelete).toHaveBeenCalled();
  });
});


describe('budget import authority adapter', () => {
  const request = { versionId: 'v', item: { category: 'Labor' as const, description: null, budgeted_amount: 1.25, fiscal_year: null },
    batchId: 'b', importedAt: 'date', v2Key: 'v2', legacyKey: 'old', hasReference: false };
  it('passes the exact arguments and preserves the outcome', async () => {
    mockRpc.mockResolvedValueOnce({ data: [{ outcome: 'conflict', line_id: 'existing' }], error: null });
    await expect(importBudgetLine(request)).resolves.toEqual({ outcome: 'conflict', line_id: 'existing' });
    expect(mockRpc).toHaveBeenCalledWith('import_budget_line_v2', { p_version_id: 'v', p_category: 'Labor', p_description: null,
      p_budgeted_amount: 1.25, p_fiscal_year: null, p_batch_id: 'b', p_imported_at: 'date',
      p_v2_key: 'v2', p_legacy_key: 'old', p_has_reference: false });
  });
  it('propagates database errors and rejects unexpected outcomes', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: '23505' } });
    await expect(importBudgetLine(request)).rejects.toMatchObject({ code: '23505' });
    mockRpc.mockResolvedValueOnce({ data: [{ outcome: 'unknown' }], error: null });
    await expect(importBudgetLine(request)).rejects.toThrow(/Unexpected/);
    mockRpc.mockResolvedValueOnce({ data: [{ outcome: 'created', line_id: null }], error: null });
    await expect(importBudgetLine(request)).rejects.toThrow(/Unexpected/);
  });
});

// ---------------------------------------------------------------------------
// #1472 S6A — budget_mode on version writes, distribution read/save seam
// ---------------------------------------------------------------------------

/** A chainable builder NOT bound to mockFrom, so tests can route per table. */
function makeStandaloneBuilder(resolved: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn().mockReturnValue(builder);
  builder.eq = vi.fn().mockReturnValue(builder);
  builder.in = vi.fn().mockReturnValue(builder);
  builder.is = vi.fn().mockReturnValue(builder);
  builder.neq = vi.fn().mockReturnValue(builder);
  builder.order = vi.fn().mockReturnValue(builder);
  builder.limit = vi.fn().mockReturnValue(builder);
  builder.range = vi.fn().mockReturnValue(builder);
  builder.update = vi.fn().mockReturnValue(builder);
  builder.delete = vi.fn().mockReturnValue(builder);
  builder.insert = vi.fn().mockReturnValue(builder);
  builder.single = vi.fn().mockReturnValue(builder);
  builder.maybeSingle = vi.fn().mockReturnValue(builder);
  builder.then = (resolve: (v: typeof resolved) => void, reject?: (e: unknown) => void) =>
    Promise.resolve(resolved).then(resolve, reject);
  return builder;
}

const distributionPlanRow = {
  budget_version_id: 'v-draft',
  org_id: 'org-1',
  method: 'amount_by_year',
  inputs: { '2026': '40', '2027': '60' },
  category_overrides: { Materials: { method: 'percent_by_year', inputs: { '2026': '25', '2027': '75' } } },
  basis: {
    projectStart: '2026-01-01',
    projectEnd: '2027-12-31',
    years: [
      { name: '2026', start: '2026-01-01', end: '2026-12-31' },
      { name: '2027', start: '2027-01-01', end: '2027-12-31' },
    ],
  },
  updated_by: 'u1',
  updated_at: '2026-11-03T00:00:00Z',
};

const distributionRowRows = [
  { id: 'd1', budget_version_id: 'v-draft', org_id: 'org-1', category: 'Labor', fiscal_year: '2026', ordinal: 0, amount: 80000, method: 'amount_by_year', is_override: false },
  { id: 'd2', budget_version_id: 'v-draft', org_id: 'org-1', category: 'Labor', fiscal_year: '2027', ordinal: 1, amount: 120000, method: 'amount_by_year', is_override: false },
  { id: 'd3', budget_version_id: 'v-draft', org_id: 'org-1', category: 'Materials', fiscal_year: '2026', ordinal: 0, amount: 0, method: 'percent_by_year', is_override: true },
  { id: 'd4', budget_version_id: 'v-draft', org_id: 'org-1', category: 'Materials', fiscal_year: '2027', ordinal: 1, amount: 30000.5, method: 'percent_by_year', is_override: true },
];

const expectedPlan: BudgetDistributionPlan = {
  method: 'amount_by_year',
  inputs: { '2026': '40', '2027': '60' },
  categoryOverrides: { Materials: { method: 'percent_by_year', inputs: { '2026': '25', '2027': '75' } } },
  basis: distributionPlanRow.basis,
  rows: [
    { category: 'Labor', fiscal_year: '2026', ordinal: 0, amount: '80000', method: 'amount_by_year', is_override: false },
    { category: 'Labor', fiscal_year: '2027', ordinal: 1, amount: '120000', method: 'amount_by_year', is_override: false },
    { category: 'Materials', fiscal_year: '2026', ordinal: 0, amount: '0', method: 'percent_by_year', is_override: true },
    { category: 'Materials', fiscal_year: '2027', ordinal: 1, amount: '30000.5', method: 'percent_by_year', is_override: true },
  ],
};

describe('getBudgetDistribution (#1472 S6A)', () => {
  it('reads one atomic snapshot so replacement cannot mix old plan metadata with new rows', async () => {
    const replacementPlan: BudgetDistributionPlan = {
      method: 'by_days',
      inputs: {},
      categoryOverrides: {},
      basis: {
        projectStart: '2028-01-01',
        projectEnd: '2028-12-31',
        years: [{ name: '2028', start: '2028-01-01', end: '2028-12-31' }],
      },
      rows: [
        { category: 'Labor', fiscal_year: '2028', ordinal: 0, amount: '200000', method: 'by_days', is_override: false },
      ],
    };
    const planBuilder = makeStandaloneBuilder({ data: distributionPlanRow, error: null });
    const rowsBuilder = makeStandaloneBuilder({
      data: [{ ...distributionRowRows[0], fiscal_year: '2028', ordinal: 0, amount: 200000, method: 'by_days' }],
      error: null,
    });
    mockFrom.mockImplementation((table: string) => (table === 'budget_distribution_plans' ? planBuilder : rowsBuilder));
    makeRpcBuilder({
      data: {
        method: 'by_days',
        inputs: {},
        category_overrides: {},
        basis: replacementPlan.basis,
        rows: replacementPlan.rows,
      },
      error: null,
    });

    await expect(getBudgetDistribution('v-draft')).resolves.toEqual(replacementPlan);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('get_budget_distribution_snapshot', { p_version_id: 'v-draft' });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('parses exact strings, zero, overrides, basis, and every row from one RPC response', async () => {
    makeRpcBuilder({
      data: {
        method: expectedPlan.method,
        inputs: expectedPlan.inputs,
        category_overrides: expectedPlan.categoryOverrides,
        basis: expectedPlan.basis,
        rows: expectedPlan.rows,
      },
      error: null,
    });
    const plan = await getBudgetDistribution('v-draft');
    expect(plan).toEqual(expectedPlan);
    expect(plan?.rows.map((row) => row.amount)).toEqual(['80000', '120000', '0', '30000.5']);
    expect(plan?.rows.every((row) => typeof row.amount === 'string')).toBe(true);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('a missing visible plan is null from the RPC', async () => {
    makeRpcBuilder({ data: null, error: null });
    await expect(getBudgetDistribution('v-none')).resolves.toBeNull();
    expect(mockRpc).toHaveBeenCalledWith('get_budget_distribution_snapshot', { p_version_id: 'v-none' });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('propagates snapshot RPC failures', async () => {
    makeRpcBuilder({ data: null, error: { message: 'snapshot read denied', code: '42501' } });
    await expect(getBudgetDistribution('v-draft')).rejects.toMatchObject({ message: 'snapshot read denied', code: '42501' });
  });

  it('rejects a snapshot whose JSON payload is structurally malformed', async () => {
    const snapshot = {
      method: expectedPlan.method,
      inputs: expectedPlan.inputs,
      category_overrides: expectedPlan.categoryOverrides,
      basis: expectedPlan.basis,
      rows: expectedPlan.rows,
    };
    for (const broken of [
      { ...snapshot, basis: { noYears: true } },
      { ...snapshot, inputs: { '2026': 40 } },
      { ...snapshot, category_overrides: { Materials: { method: 'nope', inputs: {} } } },
      { ...snapshot, method: 'unknown_method' },
      { ...snapshot, rows: null },
      { ...snapshot, rows: [{ ...expectedPlan.rows[0], amount: 80000 }] },
      { ...snapshot, rows: [{ ...expectedPlan.rows[0], category: 'invalid' }] },
    ]) {
      makeRpcBuilder({ data: broken, error: null });
      await expect(getBudgetDistribution('v-draft')).rejects.toThrow(/malformed/);
    }
  });
});

describe('saveBudgetDistribution (#1472 S6A)', () => {
  it('calls the accepted six-argument RPC with the exact snapshot and no client-supplied org', async () => {
    makeRpcBuilder({ data: null, error: null });
    await expect(saveBudgetDistribution('v-draft', expectedPlan)).resolves.toBeUndefined();
    expect(mockRpc).toHaveBeenCalledTimes(1);
    const [fn, args] = mockRpc.mock.calls[0];
    expect(fn).toBe('save_budget_distribution');
    expect(args).toMatchObject({
      p_version: 'v-draft',
      p_method: 'amount_by_year',
      p_inputs: { '2026': '40', '2027': '60' },
      p_basis: expectedPlan.basis,
      p_category_overrides: expectedPlan.categoryOverrides,
    });
    // Rows pass through verbatim — category/year/ordinal/exact decimal string/method/flag — nothing more.
    expect(args.p_rows).toEqual([
      { category: 'Labor', fiscal_year: '2026', ordinal: 0, amount: '80000', method: 'amount_by_year', is_override: false },
      { category: 'Labor', fiscal_year: '2027', ordinal: 1, amount: '120000', method: 'amount_by_year', is_override: false },
      { category: 'Materials', fiscal_year: '2026', ordinal: 0, amount: '0', method: 'percent_by_year', is_override: true },
      { category: 'Materials', fiscal_year: '2027', ordinal: 1, amount: '30000.5', method: 'percent_by_year', is_override: true },
    ]);
    // Tenant scope is stamped server-side: no org_id may ever travel from the client.
    expect(JSON.stringify(args)).not.toMatch(/org_id/);
  });

  it('round-trips: the saved snapshot reads back equal', async () => {
    makeRpcBuilder({ data: null, error: null });
    await saveBudgetDistribution('v-draft', expectedPlan);
    makeRpcBuilder({
      data: {
        method: expectedPlan.method,
        inputs: expectedPlan.inputs,
        category_overrides: expectedPlan.categoryOverrides,
        basis: expectedPlan.basis,
        rows: expectedPlan.rows,
      },
      error: null,
    });
    await expect(getBudgetDistribution('v-draft')).resolves.toEqual(expectedPlan);
    expect(mockRpc).toHaveBeenNthCalledWith(2, 'get_budget_distribution_snapshot', { p_version_id: 'v-draft' });
  });

  it('maps server rejections through the shared AppError pattern (message preserved)', async () => {
    makeRpcBuilder({ data: null, error: { message: 'budget distribution for Labor must reconcile to its source lines', code: 'P0001' } });
    await expect(saveBudgetDistribution('v-draft', expectedPlan)).rejects.toMatchObject({
      message: 'budget distribution for Labor must reconcile to its source lines', code: 'P0001',
    });
  });
});

describe('returnVersion / resubmitVersion (#1413)', () => {
  it('returns a draft through the RPC with the reason and no tenant fields', async () => {
    makeRpcBuilder({ data: null, error: null });
    await expect(returnVersion('v-draft', 'Split labour by quarter')).resolves.toBeUndefined();
    expect(mockRpc).toHaveBeenCalledWith('return_budget_version', { version_id: 'v-draft', reason: 'Split labour by quarter' });
    expect(JSON.stringify(mockRpc.mock.calls)).not.toContain('org_id');
  });

  it('surfaces a separation-of-duties refusal with its code', async () => {
    makeRpcBuilder({ data: null, error: { message: 'separation of duties: You edited this version, so someone else must return it.', code: '42501' } });
    await expect(returnVersion('v-draft', 'x')).rejects.toMatchObject({ code: '42501' });
  });

  it('resubmits a returned draft through the RPC', async () => {
    makeRpcBuilder({ data: null, error: null });
    await expect(resubmitVersion('v-draft')).resolves.toBeUndefined();
    expect(mockRpc).toHaveBeenCalledWith('resubmit_budget_version', { version_id: 'v-draft' });
  });

  it('throws on a resubmit RPC error', async () => {
    makeRpcBuilder({ data: null, error: { message: 'only a returned Draft version can be resubmitted', code: 'P0001' } });
    await expect(resubmitVersion('v-draft')).rejects.toThrow('only a returned Draft version can be resubmitted');
  });
});

describe('switchBudgetDraftMode (#1472 B2)', () => {
  const lines = [
    { id: 'line-1', category: 'Labor' as const, budgeted_amount: '200000.00', fiscal_year: 'FY27' },
    { id: 'line-2', category: 'Travel & accommodation' as const, budgeted_amount: '1000.25', fiscal_year: null },
  ];

  it('sends the exact line witness and explicit assignments without client tenant fields', async () => {
    makeRpcBuilder({ data: null, error: null });
    await expect(switchBudgetDraftMode('v-draft', 'per_year', lines, [
      { id: 'line-1', fiscal_year: 'FY27' },
      { id: 'line-2', fiscal_year: 'FY28' },
    ])).resolves.toBeUndefined();
    expect(mockRpc).toHaveBeenCalledWith('switch_budget_draft_mode', {
      p_version: 'v-draft',
      p_target_mode: 'per_year',
      p_expected_lines: lines,
      p_assignments: [
        { id: 'line-1', fiscal_year: 'FY27' },
        { id: 'line-2', fiscal_year: 'FY28' },
      ],
    });
    expect(JSON.stringify(mockRpc.mock.calls[0][1])).not.toMatch(/org_id/);
  });

  it('propagates stale-witness rejection without retrying or changing the caller snapshot', async () => {
    makeRpcBuilder({ data: null, error: { message: 'budget lines changed; refresh and review the mode change again', code: '40001' } });
    await expect(switchBudgetDraftMode('v-draft', 'whole_project', lines, [])).rejects.toMatchObject({
      message: 'budget lines changed; refresh and review the mode change again',
      code: '40001',
    });
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
});

describe('createBudgetVersion budget_mode (#1472 S6A, FR-001)', () => {
  function stageVersionInsert() {
    const insertPayloads: Array<Record<string, unknown>> = [];
    mockFrom.mockImplementation(() => {
      const b: Record<string, unknown> = {};
      let call = 0;
      b.select = vi.fn().mockReturnValue(b);
      b.eq = vi.fn().mockReturnValue(b);
      b.order = vi.fn().mockReturnValue(b);
      b.limit = vi.fn().mockReturnValue(b);
      b.insert = vi.fn((payload: Record<string, unknown>) => {
        insertPayloads.push(payload);
        return b;
      });
      b.single = vi.fn().mockReturnValue(b);
      b.then = (resolve: (v: { data: unknown; error: null }) => void) => {
        call++;
        const resolved = call === 1
          ? { data: [], error: null }
          : { data: { id: 'v-new', project_id: 'p1', version: 1, name: 'V1', status: 'Draft', org_id: 'org-1' }, error: null };
        return Promise.resolve(resolved).then(resolve);
      };
      return b;
    });
    return insertPayloads;
  }

  it('a UI-created version sends budget_mode whole_project explicitly', async () => {
    const payloads = stageVersionInsert();
    await createBudgetVersion('p1', 'V1', undefined, 'whole_project');
    expect(payloads[0]).toMatchObject({ budget_mode: 'whole_project', status: 'Draft' });
  });

  it('an explicit per_year request sends per_year (never silently reinterpreted)', async () => {
    const payloads = stageVersionInsert();
    await createBudgetVersion('p1', 'V1', undefined, 'per_year');
    expect(payloads[0]).toMatchObject({ budget_mode: 'per_year' });
  });

  it('a provenance call that passes no mode omits budget_mode (the import descriptor names per_year itself, see budgetDescriptor)', async () => {
    const payloads = stageVersionInsert();
    await createBudgetVersion('p1', 'Imported', { importBatchId: 'batch-1', importedAt: '2026-11-03T00:00:00Z' });
    expect(payloads[0]).not.toHaveProperty('budget_mode');
    expect(payloads[0]).toMatchObject({ status: 'Draft' });
    expect(JSON.stringify(payloads[0])).not.toMatch(/org_id/);
  });

  it('historic reads preserve the version actual persisted mode and clone writes never touch it', async () => {
    const versionRow = { id: 'v-old', project_id: 'p1', version: 1, name: 'Old', status: 'Active', budget_mode: 'per_year', org_id: 'org-1' };
    mockFrom.mockReset();
    mockRpc.mockReset();
    mockRpc.mockImplementation(() => makeStandaloneBuilder({
      data: [{ version_id: 'v-old', version_no: 1, version_row: versionRow, line_items: [], editor_ids: [], total: 100 }],
      error: null,
    }));
    const versions = await listBudgetVersions('p1');
    expect(versions[0]?.budget_mode).toBe('per_year');
    makeRpcBuilder({ data: 'v-clone', error: null });
    await cloneVersion('v-old');
    const [cloneFn, cloneArgs] = mockRpc.mock.calls[mockRpc.mock.calls.length - 1];
    expect(cloneFn).toBe('clone_budget_version');
    expect(JSON.stringify(cloneArgs)).not.toMatch(/budget_mode|org_id/);
  });
});

describe('#1462 listLegacyBudgetArchiveLiveTargets', () => {
  function configureLegacy(binding: { version_major: number; activated_at: string | null } | null, rows: unknown[]) {
    const targetBuilder = makeFromBuilder({ data: rows, error: null });
    const bindingBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: binding, error: null }),
    };
    mockFrom.mockImplementation((table: string) => table === 'external_org_bindings' ? bindingBuilder : targetBuilder);
  }

  it('keeps legacy documents visible but unavailable under an unproven v16 binding', async () => {
    configureLegacy({ version_major: 16, activated_at: '2026-01-01T00:00:00Z' }, [
      { id: 'lm1', budget_version_id: 'v1', fiscal_year: '2026', erp_budget_name: 'BUD-OLD', erp_docstatus: 1, erp_cancelled_at: null, push_state: 'pushed', activated_at_witness: null },
      { id: 'lm2', budget_version_id: 'v1', fiscal_year: '2027', erp_budget_name: null, erp_docstatus: null, erp_cancelled_at: null, push_state: 'failed', activated_at_witness: '2026-01-01T00:00:00Z' },
      { id: 'lm3', budget_version_id: 'v1', fiscal_year: '2028', erp_budget_name: 'BUD-CANCELLED', erp_docstatus: 2, erp_cancelled_at: null, push_state: 'pushed', activated_at_witness: '2026-01-01T00:00:00Z' },
    ]);

    const targets = await listLegacyBudgetArchiveLiveTargets(['v1']);

    expect(targets.map((row) => row.id)).toEqual(['lm1']);
    expect(targets[0]).toMatchObject({ source_kind: 'legacy', erp_account: '', budget_intent: 'ensure', archive_cancellation_available: false });
    expect(targets[0].activated_at_witness).toBeNull();
    expect(mockFrom).toHaveBeenCalledWith('budget_version_erp_mirror');
    expect(mockIs).toHaveBeenCalledWith('erp_cancelled_at', null);
  });

  it('reports a proven active v15 binding as compatible with legacy cancellation', async () => {
    configureLegacy({ version_major: 15, activated_at: '2026-01-01T00:00:00Z' }, [
      { id: 'lm1', budget_version_id: 'v1', fiscal_year: '2026', erp_budget_name: 'BUD-OLD', erp_docstatus: 1, erp_cancelled_at: null, push_state: 'pushed', activated_at_witness: '2026-01-01T00:00:00Z' },
    ]);

    const targets = await listLegacyBudgetArchiveLiveTargets(['v1']);

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ source_kind: 'legacy', erp_account: '', archive_cancellation_available: true });
  });

  it('keeps legacy targets visible while cancellation is unavailable', async () => {
    configureLegacy(null, [
      { id: 'lm1', budget_version_id: 'v1', fiscal_year: '2026', erp_budget_name: 'BUD-OLD', erp_docstatus: 1, erp_cancelled_at: null, push_state: 'pushed', activated_at_witness: '2026-01-01T00:00:00Z' },
    ]);

    const targets = await listLegacyBudgetArchiveLiveTargets(['v1']);

    expect(targets).toHaveLength(1);
    expect(targets[0].archive_cancellation_available).toBe(false);
  });

  it('does not query when there are no versions', async () => {
    await expect(listLegacyBudgetArchiveLiveTargets([])).resolves.toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('#1462 listBudgetArchiveTargets', () => {
  it('maps the server eligibility verdict for both mirror kinds', async () => {
    makeRpcBuilder({ data: [
      { source_kind: 'legacy', fiscal_year: '2026', to_fiscal_year: null, erp_budget_name: 'BUD-OLD', eligible: true, reason: 'eligible', push_state: 'pushed', erp_docstatus: 1 },
      { source_kind: 'account', fiscal_year: '2026', to_fiscal_year: null, erp_budget_name: 'BUD-NEW', eligible: false, reason: 'command-unsettled', push_state: 'pending', erp_docstatus: 1 },
      { source_kind: 'account', fiscal_year: 'FY/Alpha', to_fiscal_year: 'FY:Beta', erp_budget_name: 'BUD-RANGE', eligible: true, reason: 'eligible', push_state: 'pushed', erp_docstatus: 1 },
    ], error: null });

    const targets = await listBudgetArchiveTargets('v1');

    expect(mockRpc).toHaveBeenCalledWith('get_budget_archive_targets', { p_version_id: 'v1' });
    expect(targets).toEqual([
      { source_kind: 'legacy', fiscal_year: '2026', to_fiscal_year: null, erp_budget_name: 'BUD-OLD', eligible: true, reason: 'eligible', push_state: 'pushed', erp_docstatus: 1 },
      { source_kind: 'account', fiscal_year: '2026', to_fiscal_year: null, erp_budget_name: 'BUD-NEW', eligible: false, reason: 'command-unsettled', push_state: 'pending', erp_docstatus: 1 },
      { source_kind: 'account', fiscal_year: 'FY/Alpha', to_fiscal_year: 'FY:Beta', erp_budget_name: 'BUD-RANGE', eligible: true, reason: 'eligible', push_state: 'pushed', erp_docstatus: 1 },
    ]);
  });

  it('reads every server target when the archive inventory exceeds PostgREST max_rows', async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => ({
      source_kind: 'legacy',
      fiscal_year: String(2000 + index),
      to_fiscal_year: null,
      erp_budget_name: `BUD-${index}`,
      eligible: index !== 1000,
      reason: index === 1000 ? 'command-unsettled' : 'eligible',
      push_state: 'pushed',
      erp_docstatus: 1,
    }));
    const ranges: Array<[number, number]> = [];
    mockRpc.mockImplementation(() => {
      const builder = {
        order: vi.fn().mockReturnThis(),
        range: vi.fn((from: number, to: number) => {
        ranges.push([from, to]);
        return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
        }),
      };
      return builder as never;
    });

    const targets = await listBudgetArchiveTargets('v1');

    expect(targets).toHaveLength(1001);
    expect(targets[1000]).toMatchObject({ eligible: false, reason: 'command-unsettled' });
    expect(ranges).toEqual([[0, 999], [1000, 1999]]);
  });

  it('fails closed on a read error instead of reporting an empty inventory', async () => {
    makeRpcBuilder({ data: null, error: { message: 'read failed', code: 'P0001' } });
    await expect(listBudgetArchiveTargets('v1')).rejects.toThrow();
  });

  it('rejects an unexpected payload rather than rendering it as truth', async () => {
    makeRpcBuilder({ data: null, error: null });
    await expect(listBudgetArchiveTargets('v1')).rejects.toThrow('unexpected response');
    makeRpcBuilder({ data: [{ source_kind: 'mystery', fiscal_year: '2026', erp_budget_name: 'X', eligible: true, reason: 'eligible' }], error: null });
    await expect(listBudgetArchiveTargets('v1')).rejects.toThrow('invalid row');
  });
});
