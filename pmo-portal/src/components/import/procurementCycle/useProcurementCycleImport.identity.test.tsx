import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useProcurementCycleImport } from './useProcurementCycleImport';
import { makeRefLookup, parseWorkbook } from '@/src/lib/import';
import { buildDryRunConflictReport } from '@/src/lib/import/procurementCycle/dryRunConflictReport';
import { commitGroups } from '@/src/lib/import/procurementCycle/commit';
import { startProcurementImportRun } from '@/src/lib/db/procurementImportSkip';

vi.mock('@/src/lib/import', async original => ({ ...await original<typeof import('@/src/lib/import')>(), parseWorkbook: vi.fn() }));
vi.mock('@/src/lib/import/procurementCycle/dryRunConflictReport', () => ({ buildDryRunConflictReport: vi.fn() }));
vi.mock('@/src/lib/import/procurementCycle/commit', () => ({ commitGroups: vi.fn() }));
vi.mock('@/src/lib/db/procurementImportSkip', () => ({ supabaseImportSkipLookup: {}, startProcurementImportRun: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(parseWorkbook).mockResolvedValue({ headers: ['case_ref', 'type', 'title'], rows: [['C', 'PR', 'Case']] } as never);
  vi.mocked(buildDryRunConflictReport).mockResolvedValue({ wouldCreate: 2, wouldSkip: 0, wouldCollide: 0 });
  vi.mocked(startProcurementImportRun).mockResolvedValue('server-run');
  vi.mocked(commitGroups).mockResolvedValue({ created: 1, failed: 0, cases: [] });
});

it('allocates a run only on confirmed apply and retains it for retry', async () => {
  const lookup = makeRefLookup([], 'Reference');
  const { result } = renderHook(() => useProcurementCycleImport(lookup, lookup, 'user'));
  const file = { name: 'input.xlsx', arrayBuffer: async () => new ArrayBuffer(0) } as File;
  await act(async () => result.current.selectFile(file));
  await act(async () => result.current.goPreview());
  expect(result.current.runIdentity).toEqual({ kind: 'provisional' });
  expect(startProcurementImportRun).not.toHaveBeenCalled();
  await act(async () => result.current.commit());
  expect(startProcurementImportRun).toHaveBeenCalledOnce();
  expect(result.current.runIdentity).toEqual({ kind: 'registered', id: 'server-run' });
  expect(vi.mocked(commitGroups).mock.calls[0][1].importBatchId).toBe('server-run');
  await act(async () => result.current.goPreview());
  await act(async () => result.current.commit());
  expect(startProcurementImportRun).toHaveBeenCalledOnce();
});

it('does not allocate a run after a preview fails or its mapping changes', async () => {
  const lookup = makeRefLookup([], 'Reference');
  const { result } = renderHook(() => useProcurementCycleImport(lookup, lookup, 'user'));
  const file = { name: 'input.xlsx', arrayBuffer: async () => new ArrayBuffer(0) } as File;
  await act(async () => result.current.selectFile(file));
  await act(async () => result.current.goPreview());
  act(() => result.current.setFieldMapping('title', 0));
  await act(async () => result.current.commit());
  expect(startProcurementImportRun).not.toHaveBeenCalled();
  vi.mocked(buildDryRunConflictReport).mockRejectedValueOnce(new Error('unavailable'));
  await act(async () => result.current.goPreview());
  await act(async () => result.current.commit());
  expect(startProcurementImportRun).not.toHaveBeenCalled();
});


it('requires a fresh preview when reference data changes', async () => {
  const lookup = makeRefLookup([], 'Reference');
  const { result, rerender } = renderHook(({ reference }) => useProcurementCycleImport(reference, reference, 'user'), { initialProps: { reference: lookup } });
  const file = { name: 'input.xlsx', arrayBuffer: async () => new ArrayBuffer(0) } as File;
  await act(async () => result.current.selectFile(file));
  await act(async () => result.current.goPreview());
  rerender({ reference: makeRefLookup([], 'Reference') });
  await act(async () => result.current.commit());
  expect(startProcurementImportRun).not.toHaveBeenCalled();
});

it('counts only valid rows in valid cases', async () => {
  vi.mocked(parseWorkbook).mockResolvedValue({ headers: ['case_ref', 'type', 'title'], rows: [['C', 'PR', ''], ['D', 'PR', 'Good']] } as never);
  const lookup = makeRefLookup([], 'Reference');
  const { result } = renderHook(() => useProcurementCycleImport(lookup, lookup, 'user'));
  await act(async () => result.current.selectFile({ name: 'input.xlsx', arrayBuffer: async () => new ArrayBuffer(0) } as File));
  expect(result.current.counts).toMatchObject({ validRecords: 1, skippedRecords: 1 });
});

it('keeps a replacement file when the earlier parse fails late', async () => {
  let rejectFirst!: (reason: Error) => void;
  vi.mocked(parseWorkbook).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; }))
    .mockResolvedValueOnce({ headers: ['case_ref', 'type', 'title'], rows: [['D', 'PR', 'New']] } as never);
  const lookup = makeRefLookup([], 'Reference');
  const { result } = renderHook(() => useProcurementCycleImport(lookup, lookup, 'user'));
  const file = (name: string) => ({ name, arrayBuffer: async () => new ArrayBuffer(0) } as File);
  let pending!: Promise<void>;
  await act(async () => { pending = result.current.selectFile(file('old.xlsx')); await Promise.resolve(); });
  await act(async () => result.current.selectFile(file('new.xlsx')));
  await act(async () => { rejectFirst(new Error('late')); await pending; });
  expect(result.current.fileName).toBe('new.xlsx');
  expect(result.current.parseError).toBeNull();
});

it('does not start writes if the session is reset while run registration is pending', async () => {
  let finish!: (id: string) => void;
  vi.mocked(startProcurementImportRun).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const lookup = makeRefLookup([], 'Reference');
  const { result } = renderHook(() => useProcurementCycleImport(lookup, lookup, 'user'));
  await act(async () => result.current.selectFile({ name: 'input.xlsx', arrayBuffer: async () => new ArrayBuffer(0) } as File));
  await act(async () => result.current.goPreview());
  let pending!: Promise<void>;
  await act(async () => { pending = result.current.commit(); await Promise.resolve(); });
  act(() => result.current.reset());
  await act(async () => { finish('server-run'); await pending; });
  expect(commitGroups).not.toHaveBeenCalled();
  expect(result.current.step).toBe('upload');
});

it('ignores an old preview after mapping changes and only permits a successful retry', async () => {
  let finish!: (value: { wouldCreate: number; wouldSkip: number; wouldCollide: number }) => void;
  vi.mocked(buildDryRunConflictReport).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ wouldCreate: 1, wouldSkip: 0, wouldCollide: 0 });
  const lookup = makeRefLookup([], 'Reference');
  const { result } = renderHook(() => useProcurementCycleImport(lookup, lookup, 'user'));
  await act(async () => result.current.selectFile({ name: 'input.xlsx', arrayBuffer: async () => new ArrayBuffer(0) } as File));
  let pending!: Promise<void>;
  await act(async () => { pending = result.current.goPreview(); });
  act(() => result.current.setFieldMapping('title', 0));
  await act(async () => { finish({ wouldCreate: 7, wouldSkip: 0, wouldCollide: 0 }); await pending; });
  expect(result.current.conflictReport).toBeNull();
  await act(async () => result.current.commit());
  expect(startProcurementImportRun).not.toHaveBeenCalled();
  await act(async () => result.current.goPreview());
  expect(result.current.parseError).toMatch(/retry/i);
  await act(async () => result.current.commit());
  expect(startProcurementImportRun).not.toHaveBeenCalled();
  await act(async () => result.current.goPreview());
  expect(result.current.conflictReport?.wouldCreate).toBe(1);
  await act(async () => result.current.commit());
  expect(startProcurementImportRun).toHaveBeenCalledOnce();
});

it('reset cancels a pending parse and allows a new file', async () => {
  let finish!: (value: { headers: string[]; rows: string[][] }) => void;
  vi.mocked(parseWorkbook).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce({ headers: ['case_ref', 'type', 'title'], rows: [['D', 'PR', 'New']] } as never);
  const lookup = makeRefLookup([], 'Reference');
  const { result } = renderHook(() => useProcurementCycleImport(lookup, lookup, 'user'));
  const file = (name: string) => ({ name, arrayBuffer: async () => new ArrayBuffer(0) } as File);
  let pending!: Promise<void>;
  await act(async () => { pending = result.current.selectFile(file('old.xlsx')); await Promise.resolve(); });
  expect(result.current.parsing).toBe(true);
  act(() => result.current.reset());
  await act(async () => result.current.selectFile(file('new.xlsx')));
  await act(async () => { finish({ headers: ['case_ref', 'type', 'title'], rows: [['C', 'PR', 'Old']] }); await pending; });
  expect(result.current.fileName).toBe('new.xlsx');
  expect(result.current.parsing).toBe(false);
});

it('does not write after unmount while run registration is pending', async () => {
  let finish!: (id: string) => void;
  vi.mocked(startProcurementImportRun).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const lookup = makeRefLookup([], 'Reference');
  const { result, unmount } = renderHook(() => useProcurementCycleImport(lookup, lookup, 'user'));
  await act(async () => result.current.selectFile({ name: 'input.xlsx', arrayBuffer: async () => new ArrayBuffer(0) } as File));
  await act(async () => result.current.goPreview());
  let pending!: Promise<void>;
  await act(async () => { pending = result.current.commit(); await Promise.resolve(); });
  unmount();
  await act(async () => { finish('server-run'); await pending; });
  expect(commitGroups).not.toHaveBeenCalled();
});

it('stops reading a cycle file when the wizard unmounts before its buffer arrives', async () => {
  let finish!: (buffer: ArrayBuffer) => void;
  const lookup = makeRefLookup([], 'Reference');
  const { result, unmount } = renderHook(() => useProcurementCycleImport(lookup, lookup, 'user'));
  const input = { name: 'input.xlsx', arrayBuffer: () => new Promise<ArrayBuffer>(resolve => { finish = resolve; }) } as File;
  let pending!: Promise<void>;
  await act(async () => { pending = result.current.selectFile(input); });
  unmount();
  await act(async () => { finish(new ArrayBuffer(0)); await pending; });
  expect(parseWorkbook).not.toHaveBeenCalled();
});

it('offers a fresh preview after references change during registration and retains the run', async () => {
  let finish!: (id: string) => void;
  vi.mocked(startProcurementImportRun).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const lookup = makeRefLookup([], 'Reference');
  const { result, rerender } = renderHook(({ reference }) => useProcurementCycleImport(reference, reference, 'user'), { initialProps: { reference: lookup } });
  await act(async () => result.current.selectFile({ name: 'input.xlsx', arrayBuffer: async () => new ArrayBuffer(0) } as File));
  await act(async () => result.current.goPreview());
  let pending!: Promise<void>;
  await act(async () => { pending = result.current.commit(); });
  rerender({ reference: makeRefLookup([], 'Reference') });
  await act(async () => { finish('server-run'); await pending; });
  expect(commitGroups).not.toHaveBeenCalled();
  expect(result.current.step).toBe('preview');
  expect(result.current.parseError).toMatch(/retry/i);
  expect(result.current.runIdentity).toEqual({ kind: 'registered', id: 'server-run' });
  await act(async () => result.current.goPreview());
  await act(async () => result.current.commit());
  expect(startProcurementImportRun).toHaveBeenCalledOnce();
  expect(vi.mocked(commitGroups).mock.calls[0][1].importBatchId).toBe('server-run');
});

it.each(['success', 'failure'] as const)('reports a started write %s after reference refresh', async outcome => {
  let finish!: (value: { created: number; failed: number; cases: [] }) => void;
  let fail!: (error: Error) => void;
  vi.mocked(commitGroups).mockImplementationOnce(() => new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
  const lookup = makeRefLookup([], 'Reference');
  const { result, rerender } = renderHook(({ reference }) => useProcurementCycleImport(reference, reference, 'user'), { initialProps: { reference: lookup } });
  await act(async () => result.current.selectFile({ name: 'input.xlsx', arrayBuffer: async () => new ArrayBuffer(0) } as File));
  await act(async () => result.current.goPreview());
  let pending!: Promise<void>;
  await act(async () => { pending = result.current.commit(); await Promise.resolve(); });
  rerender({ reference: makeRefLookup([], 'Reference') });
  await act(async () => { if (outcome === 'success') finish({ created: 1, failed: 0, cases: [] }); else fail(new Error('failed')); await pending; });
  if (outcome === 'success') {
    expect(result.current.step).toBe('result');
    expect(result.current.result?.created).toBe(1);
  } else {
    expect(result.current.step).toBe('preview');
    expect(result.current.parseError).toMatch(/retry/i);
    await act(async () => result.current.goPreview());
    await act(async () => result.current.commit());
    expect(vi.mocked(commitGroups).mock.calls[1][1].importBatchId).toBe('server-run');
  }
});

it.each(['completed', 'pending'] as const)('offers retry after reference refresh with a %s report', async state => {
  let finish!: (value: { wouldCreate: number; wouldSkip: number; wouldCollide: number }) => void;
  if (state === 'pending') vi.mocked(buildDryRunConflictReport).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const lookup = makeRefLookup([], 'Reference');
  const { result, rerender } = renderHook(({ reference }) => useProcurementCycleImport(reference, reference, 'user'), { initialProps: { reference: lookup } });
  await act(async () => result.current.selectFile({ name: 'input.xlsx', arrayBuffer: async () => new ArrayBuffer(0) } as File));
  let pending!: Promise<void>;
  await act(async () => { pending = result.current.goPreview(); if (state === 'completed') await pending; });
  rerender({ reference: makeRefLookup([], 'Reference') });
  if (state === 'pending') await act(async () => { finish({ wouldCreate: 9, wouldSkip: 0, wouldCollide: 0 }); await pending; });
  expect(result.current.conflictReport).toBeNull();
  expect(result.current.parseError).toMatch(/retry/i);
  await act(async () => result.current.commit());
  expect(startProcurementImportRun).not.toHaveBeenCalled();
  await act(async () => result.current.goPreview());
  expect(result.current.conflictReport?.wouldCreate).toBe(2);
});

it.each(['reset', 'unmount'] as const)('does not deliver a started write result after %s', async cancel => {
  let finish!: (value: { created: number; failed: number; cases: [] }) => void;
  vi.mocked(commitGroups).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const lookup = makeRefLookup([], 'Reference');
  const { result, unmount } = renderHook(() => useProcurementCycleImport(lookup, lookup, 'user'));
  await act(async () => result.current.selectFile({ name: 'input.xlsx', arrayBuffer: async () => new ArrayBuffer(0) } as File));
  await act(async () => result.current.goPreview());
  let pending!: Promise<void>;
  await act(async () => { pending = result.current.commit(); await Promise.resolve(); });
  if (cancel === 'reset') act(() => result.current.reset()); else unmount();
  await act(async () => { finish({ created: 1, failed: 0, cases: [] }); await pending; });
  if (cancel === 'reset') { expect(result.current.step).toBe('upload'); expect(result.current.result).toBeNull(); }
});

it('previews unsupported creation values without registering or writing the case', async () => {
  vi.mocked(parseWorkbook).mockResolvedValue({ headers: ['case_ref', 'type', 'title', 'status'], rows: [['C', 'PR', 'Case', 'Draft'], ['C', 'Payment', '', 'Paid']] } as never);
  const lookup = makeRefLookup([], 'Reference');
  const { result } = renderHook(() => useProcurementCycleImport(lookup, lookup, 'user'));
  await act(async () => result.current.selectFile({ name: 'input.xlsx', arrayBuffer: async () => new ArrayBuffer(0) } as File));
  await act(async () => result.current.goPreview());
  expect(result.current.counts.validRecords).toBe(0);
  expect(result.current.validatedGroups[0].rows[1].errors.join(' ')).toMatch(/status/i);
  await act(async () => result.current.commit());
  expect(startProcurementImportRun).not.toHaveBeenCalled();
  expect(commitGroups).not.toHaveBeenCalled();
});
