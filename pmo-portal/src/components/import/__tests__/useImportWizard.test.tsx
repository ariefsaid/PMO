import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useImportWizard } from '../useImportWizard';
import type { ImportDescriptor } from '@/src/lib/import';
import { AppError } from '@/src/lib/appError';

// SECURITY (2026-07-27 review round 2 #2): the per-row commit loop must NOT fire one
// `save_failed` event per failed row (a 10k-row import failing wholesale would multiply one
// click into ~10k events — PostHog's overage DISCARDS PERMANENTLY). Mock the analytics facade
// so the test can assert the aggregate-vs-per-row shape directly.
const analytics = vi.hoisted(() => ({ trackSaveFailed: vi.fn(), trackBulkImportFailed: vi.fn() }));
vi.mock('@/src/lib/analytics', () => analytics);
beforeEach(() => {
  analytics.trackSaveFailed.mockClear();
  analytics.trackBulkImportFailed.mockClear();
});

interface Co {
  name: string;
  type: string;
}

/** A descriptor with a stub create + a stub parse path (we inject `parsed` directly). */
function makeDescriptor(create: ImportDescriptor<Co>['create']): ImportDescriptor<Co> {
  return {
    entity: 'Companies',
    fields: [
      { key: 'name', label: 'Company name', required: true, validate: (r) => (r.trim() ? null : 'required') },
      { key: 'type', label: 'Type', required: true, validate: (r) => (['Client', 'Vendor'].includes(r.trim()) ? null : 'enum') },
    ],
    toInput: (c) => ({ name: c.name.trim(), type: c.type.trim() }),
    create,
  };
}

/**
 * Drive the hook to the preview step WITHOUT exceljs: stub selectFile by seeding `parsed`
 * via a real File whose parse we mock at the module boundary. Simpler: mock parseWorkbook.
 */
vi.mock('@/src/lib/import', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/import')>();
  return { ...actual, parseWorkbook: vi.fn() };
});

import { parseWorkbook } from '@/src/lib/import';

const file = (name = 'x.xlsx') => new File(['x'], name);

describe('useImportWizard', () => {
  it('AC-IMP-005a: commit creates one record per VALID row via descriptor.create, skips invalid rows, and reports created/failed counts', async () => {
    (parseWorkbook as ReturnType<typeof vi.fn>).mockResolvedValue({
      headers: ['Company name', 'Type'],
      rows: [
        ['Acme', 'Client'], // valid → created
        ['', 'Vendor'], // INVALID (blank name) → never sent to create
        ['Dup Co', 'Vendor'], // valid → create rejects (23505)
      ],
    });
    const create = vi
      .fn()
      .mockResolvedValueOnce({ id: '1' }) // Acme ok
      .mockRejectedValueOnce(new AppError('duplicate key', '23505')); // Dup Co fails
    const descriptor = makeDescriptor(create);

    const { result } = renderHook(() => useImportWizard(descriptor));

    await act(async () => {
      await result.current.selectFile(file());
    });
    expect(result.current.step).toBe('mapping');
    expect(result.current.allRequiredMapped).toBe(true);

    act(() => result.current.goPreview());
    expect(result.current.step).toBe('preview');
    // Dry-run summary: 2 valid, 1 invalid, 3 total — and create NOT called yet (no write on preview).
    expect(result.current.counts).toEqual({ valid: 2, invalid: 1, total: 3 });
    expect(create).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.commit();
    });

    await waitFor(() => expect(result.current.step).toBe('result'));
    // create called exactly twice (the two VALID rows), never for the invalid blank-name row.
    expect(create).toHaveBeenCalledTimes(2);
    expect(result.current.result?.created).toBe(1);
    expect(result.current.result?.failed).toHaveLength(1);
    expect(result.current.result?.failed[0].index).toBe(2); // the "Dup Co" row index
  });

  it('AC-IMP-005b: a per-row create rejection does not abort the run — later valid rows still create', async () => {
    (parseWorkbook as ReturnType<typeof vi.fn>).mockResolvedValue({
      headers: ['Company name', 'Type'],
      rows: [
        ['First', 'Client'], // rejects
        ['Second', 'Vendor'], // must STILL be attempted + created
      ],
    });
    const create = vi
      .fn()
      .mockRejectedValueOnce(new AppError('boom', '42501'))
      .mockResolvedValueOnce({ id: '2' });
    const descriptor = makeDescriptor(create);

    const { result } = renderHook(() => useImportWizard(descriptor));
    await act(async () => {
      await result.current.selectFile(file());
    });
    act(() => result.current.goPreview());
    await act(async () => {
      await result.current.commit();
    });

    await waitFor(() => expect(result.current.step).toBe('result'));
    expect(create).toHaveBeenCalledTimes(2);
    expect(result.current.result?.created).toBe(1);
    expect(result.current.result?.failed.map((f) => f.index)).toEqual([0]);
  });

  it('SECURITY (review round 2 #2, revised per code-quality review #2): multiple failed rows ' +
    'with DIFFERENT classifications fire ONE bulk_import_failed event PER CLASSIFICATION — never ' +
    'save_failed, and never a single lump event that discards the reason distribution', async () => {
    (parseWorkbook as ReturnType<typeof vi.fn>).mockResolvedValue({
      headers: ['Company name', 'Type'],
      rows: [
        ['First', 'Client'],  // rejects — 42501 (permission_denied)
        ['Second', 'Vendor'], // rejects — 23505 (duplicate)
        ['Third', 'Client'],  // creates
      ],
    });
    const create = vi
      .fn()
      .mockRejectedValueOnce(new AppError('boom', '42501'))
      .mockRejectedValueOnce(new AppError('boom', '23505'))
      .mockResolvedValueOnce({ id: '3' });
    const descriptor = makeDescriptor(create);

    const { result } = renderHook(() => useImportWizard(descriptor));
    await act(async () => {
      await result.current.selectFile(file());
    });
    act(() => result.current.goPreview());
    await act(async () => {
      await result.current.commit();
    });

    await waitFor(() => expect(result.current.step).toBe('result'));
    expect(result.current.result?.failed).toHaveLength(2);
    // Never the old event, never a single lump call.
    expect(analytics.trackSaveFailed).not.toHaveBeenCalled();
    expect(analytics.trackBulkImportFailed).toHaveBeenCalledTimes(2);
    expect(analytics.trackBulkImportFailed).toHaveBeenCalledWith('companies', 'permission_denied', 1);
    expect(analytics.trackBulkImportFailed).toHaveBeenCalledWith('companies', 'duplicate', 1);
  });

  it('SECURITY (review round 2 #2): a clean run (zero failures) fires no aggregate event', async () => {
    (parseWorkbook as ReturnType<typeof vi.fn>).mockResolvedValue({
      headers: ['Company name', 'Type'],
      rows: [['First', 'Client']],
    });
    const create = vi.fn().mockResolvedValue({ id: '1' });
    const { result } = renderHook(() => useImportWizard(makeDescriptor(create)));
    await act(async () => {
      await result.current.selectFile(file());
    });
    act(() => result.current.goPreview());
    await act(async () => {
      await result.current.commit();
    });
    await waitFor(() => expect(result.current.step).toBe('result'));
    expect(analytics.trackSaveFailed).not.toHaveBeenCalled();
    expect(analytics.trackBulkImportFailed).not.toHaveBeenCalled();
  });

  it('a parse rejection keeps the wizard on upload with an error and writes nothing', async () => {
    const { ImportParseError } = await vi.importActual<typeof import('@/src/lib/import')>('@/src/lib/import');
    (parseWorkbook as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ImportParseError('too_many_rows', 'Too many rows.'),
    );
    const create = vi.fn();
    const { result } = renderHook(() => useImportWizard(makeDescriptor(create)));

    await act(async () => {
      await result.current.selectFile(file());
    });
    expect(result.current.step).toBe('upload');
    expect(result.current.parseError).toMatch(/too many/i);
    expect(create).not.toHaveBeenCalled();
  });
});
