import { describe, it, expect, vi, beforeEach } from 'vitest';

// A flexible chainable mock of the supabase query builder — same harness as the
// Companies DAL test. Each terminal (awaited) call resolves the queued result;
// we assert the recorded calls.
const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const calls = {
    from: [] as unknown[],
    select: [] as unknown[],
    eq: [] as unknown[],
    is: [] as unknown[],
    order: [] as unknown[],
    insert: [] as unknown[],
    update: [] as unknown[],
    delete: 0,
    single: 0,
    maybeSingle: 0,
  };
  const builder: Record<string, unknown> = {};
  const chain = (name: keyof typeof calls) => (...args: unknown[]) => {
    if (name === 'delete' || name === 'single' || name === 'maybeSingle') {
      (calls[name] as number)++;
    } else {
      (calls[name] as unknown[]).push(args.length === 1 ? args[0] : args);
    }
    return builder;
  };
  builder.select = chain('select');
  builder.eq = chain('eq');
  builder.is = chain('is');
  builder.order = chain('order');
  builder.insert = chain('insert');
  builder.update = chain('update');
  builder.delete = chain('delete');
  builder.single = chain('single');
  builder.maybeSingle = chain('maybeSingle');
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const from = vi.fn((table: string) => {
    calls.from.push(table);
    return builder;
  });
  // rpc resolves the queued result directly (the transition workflow is RPC-only as of migration 0017).
  const rpc = vi.fn((...args: unknown[]) => {
    rpcCalls.push(args);
    return Promise.resolve(result.value);
  });
  const rpcCalls: unknown[][] = [];
  return { from, rpc, rpcCalls, calls, result };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import {
  listProjectDocuments,
  getProjectDocument,
  createProjectDocument,
  updateProjectDocument,
  transitionProjectDocument,
  deleteProjectDocument,
} from './documents';
import { AppError } from '@/src/lib/appError';

beforeEach(() => {
  h.from.mockClear();
  h.rpc.mockClear();
  h.rpcCalls.length = 0;
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) {
    if (typeof h.calls[k] === 'number') (h.calls[k] as unknown) = 0;
    else (h.calls[k] as unknown[]).length = 0;
  }
  h.result.value = { data: null, error: null };
});

describe('AC-DOC-001 listProjectDocuments (per-project register)', () => {
  it('AC-DOC-001: selects the project_documents for a project, never sends org_id, ordered by code', async () => {
    h.result.value = {
      data: [{ id: 'd1', project_id: 'p1', code: 'DOC-001', category: 'Drawing', title: 'Plan', status: 'Draft' }],
      error: null,
    };
    const rows = await listProjectDocuments('p1');
    expect(h.calls.from).toEqual(['project_documents']);
    expect(h.calls.eq).toContainEqual(['project_id', 'p1']);
    // org_id is never sent on a read (RLS scopes it)
    expect(JSON.stringify(h.calls)).not.toContain('org_id');
    expect(rows[0].title).toBe('Plan');
  });

  it('AC-DOC-001: returns [] when supabase returns null data', async () => {
    h.result.value = { data: null, error: null };
    await expect(listProjectDocuments('p1')).resolves.toEqual([]);
  });

  it('AC-DOC-001: throws AppError preserving the PG code on a read error', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(listProjectDocuments('p1')).rejects.toMatchObject({ message: 'denied', code: '42501' });
    await expect(listProjectDocuments('p1')).rejects.toBeInstanceOf(AppError);
  });
});

describe('AC-DOC-002 getProjectDocument', () => {
  it('AC-DOC-002: selects a single document by id, no org_id', async () => {
    h.result.value = { data: { id: 'd1', title: 'Plan', status: 'Draft' }, error: null };
    const row = await getProjectDocument('d1');
    expect(h.calls.from).toEqual(['project_documents']);
    expect(h.calls.eq).toContainEqual(['id', 'd1']);
    expect(h.calls.maybeSingle).toBe(1);
    expect(JSON.stringify(h.calls)).not.toContain('org_id');
    expect(row?.title).toBe('Plan');
  });

  it('AC-DOC-002: returns null when no row found', async () => {
    h.result.value = { data: null, error: null };
    await expect(getProjectDocument('missing')).resolves.toBeNull();
  });
});

describe('AC-DOC-003 createProjectDocument', () => {
  it('AC-DOC-003: inserts the metadata fields + project_id + author_id, NEVER org_id, returns the new row', async () => {
    h.result.value = {
      data: { id: 'new', project_id: 'p1', code: 'DOC-009', category: 'Drawing', title: 'New', revision: 'A', doc_date: '2026-06-08', status: 'Draft' },
      error: null,
    };
    const row = await createProjectDocument('p1', {
      code: 'DOC-009',
      category: 'Drawing',
      title: 'New',
      revision: 'A',
      doc_date: '2026-06-08',
    }, 'author-1');
    expect(h.calls.from).toEqual(['project_documents']);
    const insert = h.calls.insert[0] as Record<string, unknown>;
    expect(insert.project_id).toBe('p1');
    expect(insert.code).toBe('DOC-009');
    expect(insert.category).toBe('Drawing');
    expect(insert.title).toBe('New');
    expect(insert.revision).toBe('A');
    expect(insert.doc_date).toBe('2026-06-08');
    expect(insert.author_id).toBe('author-1');
    // NEVER org_id (RLS stamps it); status defaults server-side to Draft so it is not sent.
    expect(JSON.stringify(h.calls.insert)).not.toContain('org_id');
    expect(h.calls.single).toBe(1);
    expect(row.id).toBe('new');
  });

  it('AC-DOC-003: empty optional fields are coerced to null (not empty string)', async () => {
    h.result.value = { data: { id: 'new', title: 'T', status: 'Draft' }, error: null };
    await createProjectDocument('p1', { code: '', category: 'Spec', title: 'T', revision: '', doc_date: '' }, null);
    const insert = h.calls.insert[0] as Record<string, unknown>;
    expect(insert.code).toBeNull();
    expect(insert.revision).toBeNull();
    expect(insert.doc_date).toBeNull();
    // a null author (no current user) is still allowed (author_id is nullable)
    expect(insert.author_id).toBeNull();
  });

  it('AC-DOC-003: throws AppError preserving code 42501 when RLS denies the insert', async () => {
    h.result.value = { data: null, error: { message: 'new row violates RLS', code: '42501' } };
    await expect(
      createProjectDocument('p1', { code: 'X', category: 'Drawing', title: 'X', revision: '', doc_date: '' }, 'a1'),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('AC-DOC-004 updateProjectDocument (metadata edit)', () => {
  it('AC-DOC-004: updates the metadata fields by id, NEVER org_id / status / author_id', async () => {
    h.result.value = { data: null, error: null };
    await updateProjectDocument('d1', {
      code: 'DOC-001',
      category: 'Spec',
      title: 'Renamed',
      revision: 'B',
      doc_date: '2026-07-01',
    });
    expect(h.calls.from).toEqual(['project_documents']);
    const patch = h.calls.update[0] as Record<string, unknown>;
    expect(patch.title).toBe('Renamed');
    expect(patch.category).toBe('Spec');
    expect(patch.revision).toBe('B');
    expect(patch.doc_date).toBe('2026-07-01');
    expect(h.calls.eq).toContainEqual(['id', 'd1']);
    // metadata edit never touches org_id, status (workflow-only), or author_id (server-stamped)
    expect(patch).not.toHaveProperty('org_id');
    expect(patch).not.toHaveProperty('status');
    expect(patch).not.toHaveProperty('author_id');
  });

  it('AC-DOC-004: throws AppError with code on a denied update', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(
      updateProjectDocument('d1', { code: '', category: 'Spec', title: 'Y', revision: '', doc_date: '' }),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('AC-DOC-005 transitionProjectDocument (status workflow — RPC-only)', () => {
  it('AC-DOC-005: calls rpc("transition_document_status", {p_doc_id, p_to}), NEVER a direct update / org_id', async () => {
    h.result.value = { data: null, error: null };
    await transitionProjectDocument('d1', 'Issued');
    // Routes through the SECURITY DEFINER RPC (the SOLE writer of status as of migration 0017) —
    // never a direct table UPDATE (which the server now rejects with 42501).
    expect(h.rpcCalls[0]).toEqual(['transition_document_status', { p_doc_id: 'd1', p_to: 'Issued' }]);
    expect(h.calls.update.length).toBe(0);
    expect(JSON.stringify(h.rpcCalls)).not.toContain('org_id');
  });

  it('AC-DOC-005: throws AppError preserving the PG code on a denied transition (SoD 42501 / illegal P0001)', async () => {
    h.result.value = { data: null, error: { message: 'separation of duties', code: '42501' } };
    await expect(transitionProjectDocument('d1', 'Approved')).rejects.toMatchObject({ code: '42501' });
    await expect(transitionProjectDocument('d1', 'Approved')).rejects.toBeInstanceOf(AppError);
  });
});

describe('AC-DOC-006 deleteProjectDocument (hard-delete; Admin)', () => {
  it('AC-DOC-006: deletes by id, NEVER org_id', async () => {
    h.result.value = { data: null, error: null };
    await deleteProjectDocument('d1');
    expect(h.calls.from).toEqual(['project_documents', 'project_documents']);
    expect(h.calls.delete).toBe(1);
    expect(h.calls.eq).toContainEqual(['id', 'd1']);
    expect(JSON.stringify(h.calls.eq)).not.toContain('org_id');
  });

  it('AC-DOC-006: throws AppError with code 42501 when RLS denies the delete', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(deleteProjectDocument('d1')).rejects.toMatchObject({ code: '42501' });
  });
});
