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
