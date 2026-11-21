import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '@/src/lib/appError';

/** #2595 candidate work order DAL: the write payloads (no org_id, no status columns), refusals, and the read shape. */
const h = vi.hoisted(() => {
  const result = { value: {} as { data: unknown; error: unknown } };
  const calls: Array<[string, unknown[]]> = [];
  const rpcCalls: Array<[string, unknown]> = [];
  const builder: Record<string, unknown> = {};
  for (const k of ['select', 'eq', 'is', 'order', 'limit', 'insert', 'update'] as const) {
    builder[k] = (...a: unknown[]) => { calls.push([k, a]); return builder; };
  }
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const from = vi.fn((t: string) => { calls.push(['from', [t]]); return builder; });
  const rpc = vi.fn((n: string, a?: unknown) => { rpcCalls.push([n, a]); return Promise.resolve(result.value); });
  const storage = { upload: vi.fn(() => Promise.resolve({ error: null })), remove: vi.fn(() => Promise.resolve({ error: null })) };
  return { from, rpc, calls, rpcCalls, result, storage };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc, storage: { from: () => h.storage } } }));

import * as dal from './workOrderCandidates';

beforeEach(() => {
  h.calls.length = 0; h.rpcCalls.length = 0;
  h.storage.upload.mockClear(); h.storage.remove.mockClear();
  h.result.value = { data: [], error: null };
});

describe('candidate reads', () => {
  it('lists a project\'s candidates newest first, items in order, archived proofs dropped', async () => {
    h.result.value = {
      data: [{
        id: 'c1', org_id: 'o', project_id: 'p1', title: 'T', status: 'assessing', offered_on: '2026-11-20',
        items: [
          { id: 'i2', candidate_id: 'c1', label: 'B', position: 2, required: true, status: 'open', owner: null, proofs: [] },
          { id: 'i1', candidate_id: 'c1', label: 'A', position: 1, required: false, status: 'passed', owner: { full_name: 'Ana' },
            proofs: [{ id: 'x', file_path: 'a', file_name: 'a.pdf', archived_at: null }, { id: 'y', file_path: 'b', file_name: null, archived_at: '2026-11-01' }] },
        ],
      }],
      error: null,
    };
    const rows = await dal.listCandidates('p1');
    expect(h.calls).toContainEqual(['eq', ['project_id', 'p1']]);
    expect(h.calls).toContainEqual(['order', ['created_at', { ascending: false }]]);
    expect(rows[0].items.map((i) => i.id)).toEqual(['i1', 'i2']);
    expect(rows[0].items[0].owner_name).toBe('Ana');
    expect(rows[0].items[0].proofs.map((p) => p.id)).toEqual(['x']);
  });

  it('refuses a status it does not know rather than showing it', async () => {
    h.result.value = { data: [{ id: 'c1', status: 'weird', items: [] }], error: null };
    await expect(dal.listCandidates('p1')).rejects.toBeInstanceOf(AppError);
  });
});

describe('candidate writes', () => {
  it('creates through the RPC without org_id and trims text', async () => {
    h.result.value = { data: 'c9', error: null };
    expect(await dal.createCandidate({ projectId: 'p1', title: '  Pipe repair ', description: '  ', clientReference: ' R-1 ', replacesId: 'c0' })).toBe('c9');
    expect(h.rpcCalls[0]).toEqual(['create_work_order_candidate', {
      p_project_id: 'p1', p_title: 'Pipe repair', p_description: null, p_client_reference: 'R-1', p_offered_on: null, p_replaces_id: 'c0',
    }]);
  });

  it('decides through the RPC with the trimmed reason and returns the work order id', async () => {
    h.result.value = { data: { status: 'accepted', work_order_id: 'w1' }, error: null };
    expect(await dal.decideCandidate('c1', 'accepted', ' checked ')).toEqual({ status: 'accepted', work_order_id: 'w1' });
    expect(h.rpcCalls[0]).toEqual(['decide_work_order_candidate', { p_candidate_id: 'c1', p_decision: 'accepted', p_reason: 'checked' }]);
  });

  it('surfaces a refusal from the database with its code', async () => {
    h.result.value = { data: null, error: { message: 'CWO_NOT_READY: required items are not ready: Site', code: '23514' } };
    await expect(dal.decideCandidate('c1', 'accepted', 'go')).rejects.toMatchObject({ message: expect.stringContaining('CWO_NOT_READY'), code: '23514' });
  });

  it('saves the template as an ordered list, sending an id only for an existing item', async () => {
    h.result.value = { data: 2, error: null };
    await dal.saveTemplate([{ id: 'a', label: ' One ', required: true }, { label: 'Two', required: false }]);
    expect(h.rpcCalls[0]).toEqual(['set_work_order_candidate_template', { p_items: [{ id: 'a', label: 'One', required: true }, { label: 'Two', required: false }] }]);
  });

  it('an item update that touches no row (decided or not allowed) is an error, not a silent success', async () => {
    h.result.value = { data: [], error: null };
    await expect(dal.updateItem('i1', { status: 'passed' })).rejects.toMatchObject({ code: '42501' });
  });

  it('an item update sends only the columns given', async () => {
    h.result.value = { data: [{ id: 'i1' }], error: null };
    await dal.updateItem('i1', { status: 'not_applicable', note: 'n' });
    expect(h.calls).toContainEqual(['update', [{ status: 'not_applicable', note: 'n' }]]);
  });

  it('uploads a proof under the candidate folder and removes the file when the row is refused', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(dal.uploadProof({ id: 'c1', org_id: 'o1' }, 'i1', new File(['x'], 'Site Photo.PNG', { type: 'image/png' }))).rejects.toBeInstanceOf(AppError);
    const path = (h.storage.upload.mock.calls[0] as unknown as [string])[0];
    expect(path).toMatch(/^o1\/c1\/[0-9a-f-]{36}\/site-photo\.png$/);
    expect(h.storage.remove).toHaveBeenCalledWith([path]);
  });
});
