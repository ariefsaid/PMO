import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '@/src/lib/appError';

/** #2578 quantity change DAL: list filter/order/paging (AC-QCR-024), write payloads (never org_id or an actor), refusals, files. */
const h = vi.hoisted(() => {
  const result = { value: {} as { data: unknown; error: unknown }, queue: [] as Array<{ data: unknown; error: unknown }> };
  const calls: Array<[string, unknown[]]> = [];
  const rpcCalls: Array<[string, unknown]> = [];
  const builder: Record<string, unknown> = {};
  for (const k of ['select', 'eq', 'is', 'order', 'range', 'insert', 'update', 'maybeSingle'] as const) {
    builder[k] = (...a: unknown[]) => { calls.push([k, a]); return builder; };
  }
  const next = () => (result.queue.length ? result.queue.shift()! : result.value);
  builder.maybeSingle = () => Promise.resolve(next());
  builder.then = (resolve: (v: unknown) => unknown) => resolve(next());
  const from = vi.fn((t: string) => { calls.push(['from', [t]]); return builder; });
  const rpc = vi.fn((n: string, a?: unknown) => { rpcCalls.push([n, a]); return Promise.resolve(next()); });
  const storage = { upload: vi.fn(() => Promise.resolve({ error: null })), remove: vi.fn(() => Promise.resolve({ error: null })), createSignedUrl: vi.fn() };
  return { from, rpc, calls, rpcCalls, result, storage };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc, storage: { from: () => h.storage } } }));

import * as dal from './quantityChanges';

beforeEach(() => {
  h.calls.length = 0; h.rpcCalls.length = 0;
  h.storage.upload.mockClear(); h.storage.remove.mockClear();
  h.result.value = { data: [], error: null };
  h.result.queue = [];
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

describe('reviewer roles (change-review)', () => {
  it('AC-CHR-005 reads the list (empty when unset) and reports a write that changed no row as not allowed', async () => {
    h.result.queue = [{ data: { quantity_change_approver_roles: ['project_control_manager'] }, error: null }];
    await expect(dal.getApproverRoles('o1')).resolves.toEqual(['project_control_manager']);
    h.result.queue = [{ data: null, error: null }];
    await expect(dal.getApproverRoles('o1')).resolves.toEqual([]);
    h.result.value = { data: [], error: null };
    await expect(dal.setApproverRoles('o1', ['executive'])).rejects.toMatchObject({ code: '42501' });
    h.result.value = { data: [{ id: 'o1' }], error: null };
    await expect(dal.setApproverRoles('o1', ['executive'])).resolves.toBeUndefined();
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

describe('AC-QCR detail and derived reads (#2578)', () => {
  it('getRequest returns null for an absent request', async () => {
    h.result.queue = [{ data: null, error: null }];
    await expect(dal.getRequest('q0')).resolves.toBeNull();
  });

  it('getRequest assembles the detail: label, names, line figures validated and sorted by item code', async () => {
    h.result.queue = [
      { data: {
        id: 'q1', org_id: 'o1', status: 'submitted',
        work_orders: { id: 'w1', title: 'Road', wo_number: 'WO-9', status: 'Issued', currency: 'IDR', order_value: '1200.5' },
        author: { full_name: 'Ani' }, approver: { full_name: 'Budi' },
      }, error: null },
      { data: [ // lines (unsorted on purpose: the sort is the module's job)
        { id: 'l2', boq_item_id: 'b2', requested_quantity: '5', reason: 'r', trigger_kind: 'forecast', trigger_figure: '9', base_quantity: '1', base_version_no: 3, boq_items: { item_code: 'B', description: 'd2', unit: 'm3', rate: '2' } },
        { id: 'l1', boq_item_id: 'b1', requested_quantity: 4, reason: 'r', trigger_kind: 'progress', trigger_figure: 8, base_quantity: 2, base_version_no: 1, boq_items: null },
      ], error: null },
      { data: [{ id: 'e1', action: 'submit', from_status: 'draft', to_status: 'submitted', actor_id: 'u1', reason: null, created_at: 't' }], error: null },
      { data: [{ id: 'f1', kind: 'supporting', title: 't', file_path: 'p', uploaded_by_id: 'u1', created_at: 't' }], error: null },
    ];
    const d = await dal.getRequest('q1');
    expect(d).not.toBeNull();
    expect(d!.workOrder).toEqual({ id: 'w1', label: 'WO-9 · Road', status: 'Issued', currency: 'IDR', orderValue: 1200.5 });
    expect(d!.names).toEqual({ author: 'Ani', approver: 'Budi' });
    expect(d!.lines.map((l) => l.item_code)).toEqual(['', 'B']); // sorted by item code; a missing boq_items flattens to empty strings
    expect(d!.lines[0]).toMatchObject({ requested_quantity: 4, trigger_figure: 8, base_quantity: 2, rate: 0, item_code: '' });
    expect(d!.events).toHaveLength(1);
    expect(d!.files).toHaveLength(1);
    expect(h.calls.some(([k, a]) => k === 'eq' && (a as unknown[])[0] === 'id' && (a as unknown[])[1] === 'q1')).toBe(true);
  });

  it('overContract passes the only-over flag and normalises every figure', async () => {
    h.result.queue = [{ data: [{ boq_item_id: 'b1', rate: '2.5', contract_quantity: '100', progress_quantity: 101, forecast_quantity: null, over_progress: true }], error: null }];
    const rows = await dal.overContract('p1', true);
    expect(rows[0]).toMatchObject({ rate: 2.5, contract_quantity: 100, progress_quantity: 101, forecast_quantity: null, over_progress: true });
    expect(h.rpcCalls).toEqual([['qcr_over_contract', { p_project_id: 'p1', p_only_over: true }]]);
    h.result.queue = [{ data: [], error: null }];
    await dal.overContract('p1');
    expect(h.rpcCalls.at(-1)).toEqual(['qcr_over_contract', { p_project_id: 'p1', p_only_over: false }]);
  });

  it('workOrderBudget and approvalState fall back to a safe default when the RPC returns no row', async () => {
    h.result.queue = [{ data: [{ request_count: 2, request_limit: 5 }], error: null }];
    await expect(dal.workOrderBudget('w1')).resolves.toEqual({ request_count: 2, request_limit: 5 });
    h.result.queue = [{ data: null, error: null }];
    await expect(dal.workOrderBudget('w1')).resolves.toEqual({ request_count: 0, request_limit: null });
    h.result.queue = [{ data: [{ can_approve: true, reason: null, eligible_approver_exists: true }], error: null }];
    await expect(dal.approvalState('q1')).resolves.toEqual({ can_approve: true, reason: null, eligible_approver_exists: true });
    h.result.queue = [{ data: [], error: null }];
    await expect(dal.approvalState('q1')).resolves.toEqual({ can_approve: false, reason: 'role', eligible_approver_exists: false });
  });

  it('listVersions numbers every quantity; updateDraft sends null lines only when clearing', async () => {
    h.result.queue = [{ data: [{ version_no: 1, quantity: '7', source: 'progress', request_id: null, created_by: 'u1', created_at: 't' }], error: null }];
    await expect(dal.listVersions('b1')).resolves.toEqual([{ version_no: 1, quantity: 7, source: 'progress', request_id: null, created_by: 'u1', created_at: 't' }]);
    expect(h.calls.some(([k, a]) => k === 'eq' && (a as unknown[])[1] === 'b1')).toBe(true);
    h.result.queue = [{ data: null, error: null }];
    await dal.updateDraft('q1', null, 'n');
    expect(h.rpcCalls.at(-1)).toEqual(['qcr_update_draft', { p_request_id: 'q1', p_lines: null, p_note: 'n' }]);
    h.result.queue = [{ data: null, error: null }];
    await dal.updateDraft('q1', [{ boqItemId: 'b1', requestedQuantity: '3', reason: 'r' }], null);
    expect(h.rpcCalls.at(-1)).toEqual(['qcr_update_draft', { p_request_id: 'q1', p_lines: [{ boq_item_id: 'b1', requested_quantity: '3', reason: 'r' }], p_note: null }]);
  });

  it('AC-QCR-021 the org limit reads as null when unset; the archive stamps the file row', async () => {
    h.result.queue = [{ data: { quantity_change_limit: 12 }, error: null }];
    await expect(dal.getLimit('o1')).resolves.toBe(12);
    h.result.queue = [{ data: { quantity_change_limit: null }, error: null }];
    await expect(dal.getLimit('o1')).resolves.toBeNull();
    h.result.queue = [{ data: null, error: null }];
    await expect(dal.getLimit('o1')).resolves.toBeNull();
    h.result.queue = [{ data: null, error: null }];
    await dal.archiveFile('f1');
    const upd = h.calls.find(([k]) => k === 'update')?.[1][0] as Record<string, unknown>;
    expect(typeof upd.archived_at).toBe('string');
    expect(h.calls.some(([k, a]) => k === 'eq' && (a as unknown[])[1] === 'f1')).toBe(true);
  });

  it('a file opens only through a signed link, and a refusal names itself', async () => {
    h.storage.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://signed/qcr' }, error: null });
    await expect(dal.fileUrl('o/q/f/a.pdf')).resolves.toBe('https://signed/qcr');
    h.storage.createSignedUrl.mockResolvedValue({ data: null, error: { message: 'gone' } });
    await expect(dal.fileUrl('x')).rejects.toBeInstanceOf(AppError);
  });
});
