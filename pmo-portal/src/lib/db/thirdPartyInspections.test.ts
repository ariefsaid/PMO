import { beforeEach, describe, expect, it, vi } from 'vitest';

// Chainable PostgREST builder + storage mock (the agentRuns.test.ts reference pattern) so the
// IO half of the module can be exercised beside the pure predicates below.
const h = vi.hoisted(() => {
  type Res = { data: unknown; error: unknown };
  const results: Res[] = [];
  const calls: Record<string, unknown[]> = {
    from: [], rpc: [], select: [], insert: [], update: [], delete: [], eq: [], is: [], in: [], not: [], order: [], limit: [], range: [], single: [], maybeSingle: [],
  };
  const next = (): Res => (results.length ? (results.shift() as Res) : { data: null, error: null });
  const builder: Record<string, unknown> = {};
  const rec = (name: keyof typeof calls) => (...args: unknown[]) => {
    calls[name].push(args.length <= 1 ? args[0] : args);
    return builder;
  };
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'is', 'in', 'not', 'order', 'limit', 'range'] as const) builder[m] = rec(m);
  builder.maybeSingle = () => { calls.maybeSingle.push(true); return Promise.resolve(next()); };
  builder.single = () => { calls.single.push(true); return Promise.resolve(next()); };
  builder.then = (res: (v: Res) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(next()).then(res, rej);
  const from = vi.fn((table: string) => { calls.from.push(table); return builder; });
  const rpc = vi.fn((fn: string, args?: unknown) => { calls.rpc.push(args ? [fn, args] : fn); return Promise.resolve(next()); });
  const storage = { upload: vi.fn(), remove: vi.fn(), createSignedUrl: vi.fn() };
  return {
    from, rpc, calls, results, push: (r: Res) => results.push(r),
    storageFrom: vi.fn(() => storage), storage,
  };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc, storage: { from: h.storageFrom } } }));

import {
  addInspectionFile, buildInspectionFilePath, cancelInspection, createInspection, getInspectionCosts,
  getInspectionFileUrl, getInspectionPrerequisites, inspectionFileRefusal, isInspectionBlocking, isInspectionComplete,
  isInspectionOverdue, listInspectionFilesBatch, listWorkOrderInspections, raiseInspectionPurchase, recordInspectionExecution,
  recordInspectionInvitation, recordInspectionReport, waiveInspection,
} from './thirdPartyInspections';
import { AppError } from '@/src/lib/appError';

const row = (status: string, result: string, waived_at: string | null = null, required_for: string[] = ['billing']) =>
  ({ status, result, waived_at, required_for }) as never;

beforeEach(() => {
  h.from.mockClear(); h.rpc.mockClear();
  h.storage.upload.mockReset(); h.storage.remove.mockReset(); h.storage.createSignedUrl.mockReset();
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) h.calls[k].length = 0;
  h.results.length = 0;
});

describe('inspection completeness (FR-TPI-016, OD-TPI-2)', () => {
  it('AC-TPI-007 reported pass and conditional are complete; fail, pending, an unreported or a cancelled inspection are not', () => {
    expect(isInspectionComplete(row('reported', 'pass'))).toBe(true);
    expect(isInspectionComplete(row('reported', 'conditional'))).toBe(true);
    expect(isInspectionComplete(row('reported', 'fail'))).toBe(false);
    expect(isInspectionComplete(row('reported', 'pending'))).toBe(false);
    expect(isInspectionComplete(row('executed', 'pass'))).toBe(false);
    expect(isInspectionComplete(row('cancelled', 'pass'))).toBe(false);
  });
  it('AC-TPI-008 a waiver completes an incomplete inspection, but never a cancelled one', () => {
    expect(isInspectionComplete(row('executed', 'pending', '2026-11-20'))).toBe(true);
    expect(isInspectionComplete(row('reported', 'fail', '2026-11-20'))).toBe(true);
    expect(isInspectionComplete(row('cancelled', 'pending', '2026-11-20'))).toBe(false);
  });
  it('a required, incomplete inspection blocks; a tracked-only or cancelled one does not', () => {
    expect(isInspectionBlocking(row('executed', 'pending'))).toBe(true);
    expect(isInspectionBlocking(row('reported', 'pass'))).toBe(false);
    expect(isInspectionBlocking(row('requested', 'pending', null, []))).toBe(false);
    expect(isInspectionBlocking(row('cancelled', 'pending'))).toBe(false);
  });
});

describe('inspectionFileRefusal (FR-TPI-021)', () => {
  it('accepts a live report file and refuses by count, size and type, naming which', () => {
    const good = { size: 100, type: 'application/pdf' };
    expect(inspectionFileRefusal(good, 0)).toBeNull();
    expect(inspectionFileRefusal(good, 10)).toBe('count');
    expect(inspectionFileRefusal({ size: 15 * 1024 * 1024 + 1, type: 'application/pdf' }, 0)).toBe('size');
    expect(inspectionFileRefusal({ size: 10, type: 'application/zip' }, 0)).toBe('type');
  });
});

describe('overdue', () => {
  it('a planned date in the past on an unreported, un-waived inspection is overdue', () => {
    expect(isInspectionOverdue({ status: 'invited', planned_date: '2026-03-01' } as never, '2026-03-10')).toBe(true);
    expect(isInspectionOverdue({ status: 'reported', planned_date: '2026-03-01' } as never, '2026-03-10')).toBe(false);
    expect(isInspectionOverdue({ status: 'cancelled', planned_date: '2026-03-01' } as never, '2026-03-10')).toBe(false);
    expect(isInspectionOverdue({ status: 'invited', planned_date: '2026-03-10' } as never, '2026-03-10')).toBe(false);
  });
});

describe('the work order reads', () => {
  it('listWorkOrderInspections caps at 200 oldest first and never selects the unreadable estimate column', async () => {
    h.push({ data: [{ id: 'i1' }], error: null });
    const rows = await listWorkOrderInspections('wo1');
    expect(rows).toEqual([{ id: 'i1' }]);
    expect(h.calls.from).toEqual(['third_party_inspections']);
    expect(h.calls.eq).toContainEqual(['work_order_id', 'wo1']);
    expect(h.calls.order).toContainEqual(['created_at', { ascending: true }]);
    expect(h.calls.limit).toContainEqual(200);
    expect(String(h.calls.select[0])).not.toContain('estimate');
  });

  it('a list refusal keeps its code', async () => {
    h.push({ data: null, error: { message: 'denied', code: '42501' } });
    await expect(listWorkOrderInspections('wo1')).rejects.toMatchObject({ code: '42501' });
    h.push({ data: null, error: { message: 'denied', code: '42501' } });
    await expect(listWorkOrderInspections('wo1')).rejects.toBeInstanceOf(AppError);
  });

  it('getInspectionCosts goes through the costs RPC scoped to the work order', async () => {
    h.push({ data: [{ inspection_id: 'i1', cost: 100 }], error: null });
    await expect(getInspectionCosts('wo1')).resolves.toEqual([{ inspection_id: 'i1', cost: 100 }]);
    expect(h.calls.rpc).toEqual([['tpi_costs', { p_work_order_id: 'wo1' }]]);
  });

  it('getInspectionPrerequisites asks the gate; the readiness gate has no section', async () => {
    h.push({ data: { complete: true, inspections: [] }, error: null });
    await expect(getInspectionPrerequisites('wo1', 'readiness')).resolves.toEqual({ complete: true, inspections: [] });
    expect(h.calls.rpc).toEqual([['work_order_inspection_prerequisites', { p_work_order_id: 'wo1', p_section_id: null, p_gate: 'readiness' }]]);
  });
});

describe('the state-machine writes', () => {
  it('createInspection sends the camelCase input mapped onto the tpi_create arguments', async () => {
    h.push({ data: 'i1', error: null });
    await expect(createInspection({
      workOrderId: 'wo1', title: 'Weld RT', testKind: 'rt', plannedDate: '2026-03-10', vendorId: 'v1',
      estimate: 1000, estimateCurrency: 'IDR', note: 'n', requiredFor: ['billing'],
    })).resolves.toBe('i1');
    expect(h.calls.rpc).toEqual([['tpi_create', {
      p_work_order_id: 'wo1', p_title: 'Weld RT', p_test_kind: 'rt', p_planned_date: '2026-03-10',
      p_vendor_id: 'v1', p_estimate: 1000, p_estimate_currency: 'IDR', p_note: 'n', p_required_for: ['billing'],
    }]]);
  });

  it('raiseInspectionPurchase sends the procurement id, or null when none', async () => {
    h.push({ data: 'po9', error: null });
    await expect(raiseInspectionPurchase('i1', 'po9')).resolves.toBe('po9');
    expect(h.calls.rpc.at(-1)).toEqual(['tpi_raise_purchase', { p_id: 'i1', p_procurement_id: 'po9' }]);
    h.push({ data: null, error: null });
    await raiseInspectionPurchase('i1');
    expect(h.calls.rpc.at(-1)).toEqual(['tpi_raise_purchase', { p_id: 'i1', p_procurement_id: null }]);
  });

  it('recordInspectionInvitation sends when/who/how', async () => {
    h.push({ data: null, error: null });
    await recordInspectionInvitation('i1', '2026-03-01', 'Dewi', 'email');
    expect(h.calls.rpc).toEqual([['tpi_record_invitation', { p_id: 'i1', p_invited_on: '2026-03-01', p_invited_who: 'Dewi', p_invited_how: 'email' }]]);
  });

  it('recordInspectionExecution sends the execution date', async () => {
    h.push({ data: null, error: null });
    await recordInspectionExecution('i1', '2026-03-02');
    expect(h.calls.rpc).toEqual([['tpi_record_execution', { p_id: 'i1', p_executed_on: '2026-03-02' }]]);
  });

  it('waiveInspection and cancelInspection carry their reasons', async () => {
    h.push({ data: null, error: null });
    await waiveInspection('i1', 'client waiver');
    expect(h.calls.rpc.at(-1)).toEqual(['tpi_waive', { p_id: 'i1', p_reason: 'client waiver' }]);
    h.push({ data: null, error: null });
    await cancelInspection('i1', 'scope change');
    expect(h.calls.rpc.at(-1)).toEqual(['tpi_cancel', { p_id: 'i1', p_reason: 'scope change' }]);
  });

  it('recordInspectionReport sends the result', async () => {
    h.push({ data: null, error: null });
    await recordInspectionReport('i1', 'conditional');
    expect(h.calls.rpc).toEqual([['tpi_record_report', { p_id: 'i1', p_result: 'conditional' }]]);
  });

  it('a refused state change keeps the database code', async () => {
    h.push({ data: null, error: { message: 'wrong state', code: 'P0001' } });
    await expect(waiveInspection('i1', 'r')).rejects.toMatchObject({ code: 'P0001' });
  });
});

describe('report files', () => {
  it('buildInspectionFilePath keys at org, inspection, file and a sanitised name', () => {
    expect(buildInspectionFilePath('o1', 'i1', 'f1', 'weld report.pdf').split('/').slice(0, 3)).toEqual(['o1', 'i1', 'f1']);
  });

  it('listInspectionFilesBatch reads the live files, newest first, capped at the maximum count', async () => {
    h.push({ data: [{ id: 'f1', file_path: 'p' }], error: null });
    await expect(listInspectionFilesBatch(['i1'])).resolves.toEqual([{ id: 'f1', file_path: 'p' }]);
    expect(h.calls.from).toEqual(['third_party_inspection_files']);
    expect(h.calls.in).toContainEqual(['inspection_id', ['i1']]);
    expect(h.calls.is).toContainEqual(['archived_at', null]);
    expect(h.calls.order).toContainEqual(['created_at', { ascending: false }]);
  });

  it('reads 30 inspections in one file query, preserving each inspection file cap', async () => {
    const ids = Array.from({ length: 30 }, (_, n) => `i${n}`);
    const rows = ids.flatMap(inspection_id => Array.from({ length: 11 }, (_, n) => ({ id: `${inspection_id}-${n}`, inspection_id })));
    h.push({ data: rows, error: null });
    const files = await listInspectionFilesBatch(ids);
    expect(h.calls.from).toEqual(['third_party_inspection_files']);
    expect(h.calls.in).toContainEqual(['inspection_id', ids]);
    expect(h.calls.is).toContainEqual(['archived_at', null]);
    expect(files).toHaveLength(300);
    expect(files.filter(f => f.inspection_id === 'i0').map(f => f.id)).toEqual(Array.from({ length: 10 }, (_, n) => `i0-${n}`));
  });

  it('addInspectionFile refuses before upload when the count/size/type gate says so', async () => {
    const file = new File(['x'], 'r.pdf', { type: 'application/zip' });
    await expect(addInspectionFile({ id: 'i1', org_id: 'o1' } as never, file, 0)).rejects.toMatchObject({ code: 'inspection-file-type' });
    expect(h.storage.upload).not.toHaveBeenCalled();
    const big = new File([new Uint8Array(15 * 1024 * 1024 + 1)], 'r.pdf', { type: 'application/pdf' });
    await expect(addInspectionFile({ id: 'i1', org_id: 'o1' } as never, big, 0)).rejects.toMatchObject({ code: 'inspection-file-size' });
    expect(h.storage.upload).not.toHaveBeenCalled();
  });

  it('addInspectionFile uploads then records, and removes the object when the row refuses (no orphan)', async () => {
    const file = new File(['x'], 'weld report.pdf', { type: 'application/pdf' });
    h.storage.upload.mockResolvedValue({ data: { path: 'p' }, error: null });
    h.push({ data: null, error: { message: 'row refused', code: '23503' } });
    await expect(addInspectionFile({ id: 'i1', org_id: 'o1' } as never, file, 0)).rejects.toMatchObject({ code: '23503' });
    expect(h.storageFrom).toHaveBeenCalledWith('inspection-reports');
    expect(h.storage.upload).toHaveBeenCalledTimes(1);
    const upPath = h.storage.upload.mock.calls[0]![0] as string;
    expect(upPath).toMatch(/^o1\/i1\/[0-9a-f-]{36}\//);
    expect(h.storage.remove).toHaveBeenCalledWith([upPath]);
  });

  it('a failed object upload refuses before any row is written', async () => {
    const file = new File(['x'], 'r.pdf', { type: 'application/pdf' });
    h.storage.upload.mockResolvedValue({ data: null, error: { message: 'bucket denied' } });
    await expect(addInspectionFile({ id: 'i1', org_id: 'o1' } as never, file, 0)).rejects.toBeInstanceOf(AppError);
    expect(h.calls.insert).toEqual([]);
  });

  it('getInspectionFileUrl signs for the shared expiry or refuses', async () => {
    h.storage.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://signed/f' }, error: null });
    await expect(getInspectionFileUrl('o1/i1/f/r.pdf')).resolves.toBe('https://signed/f');
    h.storage.createSignedUrl.mockResolvedValue({ data: null, error: { message: 'gone' } });
    await expect(getInspectionFileUrl('x')).rejects.toBeInstanceOf(AppError);
  });
});
