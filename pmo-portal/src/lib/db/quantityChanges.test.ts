import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '@/src/lib/appError';

/** #2578 quantity change DAL: list filter/order/paging (AC-QCR-024), write payloads (never org_id or an actor), refusals, files. */
const h = vi.hoisted(() => {
  const result = { value: {} as { data: unknown; error: unknown } };
  const calls: Array<[string, unknown[]]> = [];
  const rpcCalls: Array<[string, unknown]> = [];
  const builder: Record<string, unknown> = {};
  for (const k of ['select', 'eq', 'is', 'order', 'range', 'insert', 'update', 'maybeSingle'] as const) {
    builder[k] = (...a: unknown[]) => { calls.push([k, a]); return builder; };
  }
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const from = vi.fn((t: string) => { calls.push(['from', [t]]); return builder; });
  const rpc = vi.fn((n: string, a?: unknown) => { rpcCalls.push([n, a]); return Promise.resolve(result.value); });
  const storage = { upload: vi.fn(() => Promise.resolve({ error: null })), remove: vi.fn(() => Promise.resolve({ error: null })) };
  return { from, rpc, calls, rpcCalls, result, storage };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc, storage: { from: () => h.storage } } }));

import * as dal from './quantityChanges';

beforeEach(() => {
  h.calls.length = 0; h.rpcCalls.length = 0;
  h.storage.upload.mockClear(); h.storage.remove.mockClear();
  h.result.value = { data: [], error: null };
});

describe('AC-QCR-024 list', () => {
  it('filters by project, work order and status, newest first with a stable tie-break', async () => {
    await dal.listRequests({ projectId: 'p1', workOrderId: 'w1', status: 'approved' }, 1);
    const ops = h.calls.filter(([k]) => k !== 'select' && k !== 'from');
    expect(ops).toEqual([
      ['eq', ['project_id', 'p1']],
      ['eq', ['work_order_id', 'w1']],
      ['eq', ['status', 'approved']],
      ['order', ['created_at', { ascending: false }]],
      ['order', ['id', { ascending: false }]],
      ['range', [dal.QCR_PAGE_SIZE, dal.QCR_PAGE_SIZE * 2]],
    ]);
  });

  it('a page is bounded and the extra row only says there is more', async () => {
    h.result.value = { data: Array.from({ length: dal.QCR_PAGE_SIZE + 1 }, (_, i) => ({ id: String(i), quantity_change_request_lines: [{ count: 1 }] })), error: null };
    const page = await dal.listRequests({});
    expect(page.rows).toHaveLength(dal.QCR_PAGE_SIZE);
    expect(page.hasMore).toBe(true);
  });
});

describe('writes', () => {
  it('AC-QCR-009 raises with a client request id and never sends org_id or an author', async () => {
    h.result.value = { data: 'q1', error: null };
    await expect(dal.raiseRequest({
      workOrderId: 'w1', clientRequestId: 'c1', note: ' ',
      lines: [{ boqItemId: 'b1', requestedQuantity: '1100', reason: 'Rock' }],
    })).resolves.toBe('q1');
    const [name, args] = h.rpcCalls[0] as [string, Record<string, unknown>];
    expect(name).toBe('qcr_raise');
    expect(args).toEqual({ p_work_order_id: 'w1', p_client_request_id: 'c1', p_note: ' ', p_lines: [{ boq_item_id: 'b1', requested_quantity: '1100', reason: 'Rock' }] });
    expect(JSON.stringify(args)).not.toMatch(/org_id|author|editor/);
  });

  it('AC-QCR-011 a separation-of-duties refusal keeps its Postgres code so the screen can explain it', async () => {
    h.result.value = { data: null, error: { message: 'separation of duties: the author cannot approve this request', code: '42501' } };
    const err = await dal.approveRequest('q1').catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as { code?: string }).code).toBe('42501');
  });

  it('sends each transition to its own function', async () => {
    h.result.value = { data: null, error: null };
    await dal.submitRequest('q1');
    await dal.returnRequest('q1', 'why');
    await dal.withdrawRequest('q1', 'gone');
    await dal.recordSent('q1', '2026-03-10', 'REF-1');
    await dal.recordDecision('q1', 'accepted', '2026-03-12', null);
    await dal.recordForecast('b1', '1100', null);
    expect(h.rpcCalls.map(([n]) => n)).toEqual(['qcr_submit', 'qcr_return', 'qcr_withdraw', 'qcr_record_sent', 'qcr_record_decision', 'record_quantity_forecast']);
    expect(h.rpcCalls[3][1]).toEqual({ p_request_id: 'q1', p_sent_date: '2026-03-10', p_client_reference: 'REF-1' });
    expect(h.rpcCalls[4][1]).toEqual({ p_request_id: 'q1', p_decision: 'accepted', p_decision_date: '2026-03-12', p_note: null });
  });

  it('AC-QCR-022 a limit write that changed no row is reported as not allowed (the Admin-only policy filters it)', async () => {
    h.result.value = { data: [], error: null };
    await expect(dal.setLimit('o1', 3)).rejects.toMatchObject({ code: '42501' });
    h.result.value = { data: [{ id: 'o1' }], error: null };
    await expect(dal.setLimit('o1', 3)).resolves.toBeUndefined();
  });
});

describe('files', () => {
  it('stores the object under {org}/{request}/{file}/{name}, then the typed row with that id', async () => {
    h.result.value = { data: null, error: null };
    await dal.uploadFile({ id: 'q1', org_id: 'o1' }, 'sent_letter', new File(['x'], 'Letter 1.pdf', { type: 'application/pdf' }));
    const path = (h.storage.upload.mock.calls as unknown as [string][])[0][0];
    expect(path).toMatch(/^o1\/q1\/[0-9a-f-]{36}\/letter-1\.pdf$/);
    const insert = h.calls.find(([k]) => k === 'insert')?.[1][0] as Record<string, unknown>;
    expect(insert).toMatchObject({ request_id: 'q1', kind: 'sent_letter', file_path: path });
    expect(path.split('/')[2]).toBe(insert.id);
    expect(insert).not.toHaveProperty('org_id');
  });

  it('removes the orphan object when the row is refused', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(dal.uploadFile({ id: 'q1', org_id: 'o1' }, 'sent_letter', new File(['x'], 'a.pdf'))).rejects.toBeInstanceOf(AppError);
    expect(h.storage.remove).toHaveBeenCalledTimes(1);
  });
});
