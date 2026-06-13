/**
 * useExport — exercises the real download orchestration in jsdom: build rows →
 * (mocked) buffer → Blob → object URL → programmatic `<a download>` click → revoke.
 * Only `toWorkbookBuffer` is mocked (its real exceljs path is proven separately in
 * toWorkbookBuffer.test.ts); the Blob/anchor/URL wiring here is real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Column } from '@/src/components/ui';
import { useExport } from '../useExport';

vi.mock('@/src/lib/export/toWorkbookBuffer', () => ({
  toWorkbookBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
}));

type R = { name: string; value: number };
const cols: Column<R>[] = [
  { key: 'name', header: 'Name', cell: (r) => r.name, exportValue: (r) => r.name },
  { key: 'value', header: 'Value', cell: (r) => r.value, exportValue: (r) => r.value },
];

describe('useExport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom lacks createObjectURL/revokeObjectURL — provide them.
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:mock'), writable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true });
  });

  it('builds the buffer, downloads a dated <Entity> file, and revokes the object URL', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { toWorkbookBuffer } = await import('@/src/lib/export/toWorkbookBuffer');

    const { result } = renderHook(() => useExport());
    expect(result.current.busy).toBe(false);

    await act(async () => {
      await result.current.exportXlsx([{ name: 'Acme', value: 1500 }], cols, 'Companies');
    });

    // toWorkbookBuffer received the built header/body keyed by the entity sheet name.
    expect(toWorkbookBuffer).toHaveBeenCalledWith({
      sheetName: 'Companies',
      header: ['Name', 'Value'],
      body: [['Acme', 1500]],
    });
    // A download anchor was clicked and the object URL was released.
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock');
    // busy resets after completion.
    expect(result.current.busy).toBe(false);

    clickSpy.mockRestore();
  });

  it('resets busy even when serialization throws', async () => {
    const { toWorkbookBuffer } = await import('@/src/lib/export/toWorkbookBuffer');
    vi.mocked(toWorkbookBuffer).mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useExport());
    await act(async () => {
      await expect(
        result.current.exportXlsx([{ name: 'Acme', value: 1 }], cols, 'Companies'),
      ).rejects.toThrow('boom');
    });
    expect(result.current.busy).toBe(false);
  });
});
