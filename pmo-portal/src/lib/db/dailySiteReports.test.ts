import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '@/src/lib/appError';

/** #1522 daily site report DAL: list filter/order/paging (AC-DSR-015), the write payloads (no org_id), refusals. */
const h = vi.hoisted(() => {
  const result = { value: {} as { data: unknown; error: unknown } };
  const calls: Array<[string, unknown[]]> = [];
  const rpcCalls: Array<[string, unknown]> = [];
  const builder: Record<string, unknown> = {};
  for (const k of ['select', 'eq', 'is', 'gte', 'lte', 'order', 'range', 'insert', 'update', 'maybeSingle'] as const) {
    builder[k] = (...a: unknown[]) => { calls.push([k, a]); return builder; };
  }
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const from = vi.fn((t: string) => { calls.push(['from', [t]]); return builder; });
  const rpc = vi.fn((n: string, a?: unknown) => { rpcCalls.push([n, a]); return Promise.resolve(result.value); });
  const storage = { upload: vi.fn(() => Promise.resolve({ error: null })), remove: vi.fn(() => Promise.resolve({ error: null })) };
  return { from, rpc, calls, rpcCalls, result, storage };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc, storage: { from: () => h.storage } } }));

import * as dal from './dailySiteReports';

beforeEach(() => {
  h.calls.length = 0; h.rpcCalls.length = 0;
  h.storage.upload.mockClear(); h.storage.remove.mockClear();
  h.result.value = { data: [], error: null };
});

describe('AC-DSR-015 list', () => {
  it('AC-DSR-015 filters by project, work order, status and date range, newest first with a stable tie-break', async () => {
    await dal.listReports({ projectId: 'p1', workOrderId: 'w1', status: 'submitted', from: '2026-03-01', to: '2026-03-31' }, 1);
    const ops = h.calls.filter(([k]) => k !== 'select' && k !== 'from');
    expect(ops).toEqual([
      ['is', ['archived_at', null]],
      ['eq', ['project_id', 'p1']],
      ['eq', ['work_order_id', 'w1']],
      ['eq', ['status', 'submitted']],
      ['gte', ['work_date', '2026-03-01']],
      ['lte', ['work_date', '2026-03-31']],
      ['order', ['work_date', { ascending: false }]],
      ['order', ['id', { ascending: false }]],
      ['range', [dal.DSR_PAGE_SIZE, dal.DSR_PAGE_SIZE * 2]],
    ]);
  });

  it('AC-DSR-015 a page is bounded and the extra row only says there is more', async () => {
    h.result.value = { data: Array.from({ length: dal.DSR_PAGE_SIZE + 1 }, (_, i) => ({ id: String(i) })), error: null };
    const page = await dal.listReports({});
    expect(page.rows).toHaveLength(dal.DSR_PAGE_SIZE);
    expect(page.hasMore).toBe(true);
  });
});

describe('AC-SRC crew and person link', () => {
  it('AC-SRC-006 filters the list by crew and reads the crew name', async () => {
    h.result.value = { data: [{ id: 'r1', work_orders: null, author: null, crew: { name: 'Pipe crew' } }], error: null };
    const page = await dal.listReports({ crewId: 'c1' });
    expect(h.calls).toContainEqual(['eq', ['crew_id', 'c1']]);
    expect(page.rows[0].crew_name).toBe('Pipe crew');
  });

  it('AC-SRC-004 a save sends the link keys only when given: leaving them out keeps the stored link', async () => {
    h.result.value = { data: 'r1', error: null };
    await dal.saveDraft({ id: 'r1', workOrderId: 'w1', workDate: '2026-03-10', progress: [], idle: [], consumables: [] });
    const without = (h.rpcCalls[0] as [string, { p: Record<string, unknown> }])[1].p;
    expect(without).not.toHaveProperty('crew_id');
    expect(without).not.toHaveProperty('person_id');
    expect(without).not.toHaveProperty('area_id');
    await dal.saveDraft({ id: 'r1', workOrderId: 'w1', workDate: '2026-03-10', crewId: 'c1', personId: null, areaId: 'a1', progress: [], idle: [], consumables: [] });
    const withKeys = (h.rpcCalls[1] as [string, { p: Record<string, unknown> }])[1].p;
    expect(withKeys).toMatchObject({ crew_id: 'c1', person_id: null, area_id: 'a1' });
  });
});

describe('writes', () => {
  it('saves a draft with a client request id and never sends org_id', async () => {
    h.result.value = { data: 'r1', error: null };
    await expect(dal.saveDraft({
      clientRequestId: 'c1', workOrderId: 'w1', workDate: '2026-03-10', startTime: '07:00', endTime: '',
      progress: [{ workOrderLineId: 'l1', subStage: '', quantity: '10' }], idle: [{ minutes: 30, reasonId: 'i1' }], consumables: [],
    })).resolves.toBe('r1');
    const [name, args] = h.rpcCalls[0] as [string, { p: Record<string, unknown> }];
    expect(name).toBe('dsr_save_draft');
    expect(args.p).not.toHaveProperty('org_id');
    expect(args.p).toMatchObject({ client_request_id: 'c1', work_order_id: 'w1', start_time: '07:00', end_time: null,
      progress: [{ work_order_line_id: 'l1', sub_stage: null, quantity: '10' }], idle: [{ minutes: 30, reason_id: 'i1' }] });
  });

  it('AC-DSR-005 a refusal keeps its Postgres code so the screen can explain it', async () => {
    h.result.value = { data: null, error: { message: 'the author of a report cannot validate it', code: '42501' } };
    const err = await dal.validateReport('r1').catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('42501');
  });

  it('returns and corrections send the reason', async () => {
    h.result.value = { data: 'r2', error: null };
    await dal.returnReport('r1', 'too high');
    await expect(dal.correctReport('r1', 'fix')).resolves.toBe('r2');
    expect(h.rpcCalls).toEqual([['dsr_return', { p_report: 'r1', p_reason: 'too high' }], ['dsr_correct', { p_report: 'r1', p_reason: 'fix' }]]);
  });

  it('a photo goes to {org}/{report}/{photo}/{file} and a refused row removes the uploaded object', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    const file = new File(['x'], 'form one.jpg', { type: 'image/jpeg' });
    await expect(dal.uploadPhoto({ id: 'r1', org_id: 'o1' }, file)).rejects.toBeInstanceOf(AppError);
    const path = (h.storage.upload.mock.calls[0] as unknown as [string])[0];
    expect(path).toMatch(/^o1\/r1\/[0-9a-f-]{36}\/form/);
    expect(h.storage.remove).toHaveBeenCalledWith([path]);
  });
});

describe('#2619 report hours', () => {
  it('reads the work order\'s hours through one RPC keyed on the report, keeping people hours exact', async () => {
    h.result.value = { data: { people_hours: '12.50', equipment: [{ id: 'u1', asset_name: 'Excavator', quantity: '6.50', unit: 'hours', kind: 'work', status: 'Approved' }] }, error: null };
    const out = await dal.reportHours('r1');
    expect(h.rpcCalls).toEqual([['dsr_report_hours', { p_report: 'r1' }]]);
    expect(out).toEqual({ peopleHours: '12.50', equipment: [{ id: 'u1', asset_name: 'Excavator', quantity: 6.5, unit: 'hours', kind: 'work', status: 'Approved' }] });
  });
  it('an RPC refusal is raised, not shown as zero hours', async () => {
    h.result.value = { data: null, error: { message: 'report not found', code: 'P0002' } };
    await expect(dal.reportHours('r1')).rejects.toBeInstanceOf(AppError);
  });
});

describe('#2621 site report lists', () => {
  it('the report pickers read only live items; the Admin editor reads archived ones too', async () => {
    h.result.value = { data: [], error: null };
    await dal.listIdleReasons();
    expect(h.calls.some(([k, a]) => k === 'is' && (a as unknown[])[0] === 'archived_at')).toBe(true);
    h.calls.length = 0;
    await dal.listListItems('idle');
    expect(h.calls.some(([k]) => k === 'is')).toBe(false);
  });
  it('add, rename and archive write only the label / archive stamp (org_id is stamped by the database)', async () => {
    await dal.addListItem('weather', '  Heavy wind ');
    await dal.renameListItem('idle', 'i1', ' Wind ');
    await dal.setListItemArchived('idle', 'i1', true);
    await dal.setListItemArchived('idle', 'i1', false);
    const ins = h.calls.find(([k]) => k === 'insert');
    expect(ins?.[1]).toEqual([{ label: 'Heavy wind' }]);
    const updates = h.calls.filter(([k]) => k === 'update').map(([, a]) => a[0]);
    expect(updates[0]).toEqual({ label: 'Wind' });
    expect(updates[1]).toMatchObject({ archived_at: expect.any(String) });
    expect(updates[2]).toEqual({ archived_at: null });
  });
});
