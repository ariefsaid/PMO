/**
 * useExport — exercises the real download orchestration in jsdom: build rows →
 * (mocked) buffer → Blob → object URL → programmatic `<a download>` click → revoke.
 * Only `toWorkbookBuffer` is mocked (its real exceljs path is proven separately in
 * toWorkbookBuffer.test.ts); the Blob/anchor/URL wiring here is real.
 *
 * AC-G3D-RESILIENCE: serialization failures are caught → toast "Export failed"
 * (no longer re-throws silently). The updated test asserts the new behaviour:
 * exportXlsx resolves (not rejects) and busy resets after an error.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, render } from '@testing-library/react';
import React from 'react';
import type { Column } from '@/src/components/ui';
import { ToastProvider } from '@/src/components/ui';
import { useExport } from '../useExport';

vi.mock('@/src/lib/export/toWorkbookBuffer', () => ({
  toWorkbookBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
}));

type R = { name: string; value: number };
const cols: Column<R>[] = [
  { key: 'name', header: 'Name', cell: (r) => r.name, exportValue: (r) => r.name },
  { key: 'value', header: 'Value', cell: (r) => r.value, exportValue: (r) => r.value },
];

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ToastProvider>{children}</ToastProvider>
);

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

    const { result } = renderHook(() => useExport(), { wrapper });
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

  it('AC-G3D-RESILIENCE: catches serialization failure → resolves (not rejects) + resets busy', async () => {
    // Previously this test asserted `rejects.toThrow('boom')` — the error
    // re-threw silently to the caller (button appeared dead with no feedback).
    // After the fix: the hook catches the error, toasts "Export failed", and
    // resolves normally. The caller (ExportButton) only needs to reset its
    // loading state, which happens because busy is reset in finally.
    const { toWorkbookBuffer } = await import('@/src/lib/export/toWorkbookBuffer');
    vi.mocked(toWorkbookBuffer).mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useExport(), { wrapper });
    // exportXlsx must RESOLVE (not reject) when serialization throws.
    await act(async () => {
      await expect(
        result.current.exportXlsx([{ name: 'Acme', value: 1 }], cols, 'Companies'),
      ).resolves.toBeUndefined();
    });
    // busy resets regardless of the error path.
    expect(result.current.busy).toBe(false);
  });

  it('AC-G3D-RESILIENCE: a failure toasts "Export failed" to the user', async () => {
    // Render the hook inside a ToastProvider so we can assert the toast text.
    const { toWorkbookBuffer } = await import('@/src/lib/export/toWorkbookBuffer');
    vi.mocked(toWorkbookBuffer).mockRejectedValueOnce(new Error('disk full'));

    function ExportWrapper() {
      const { exportXlsx } = useExport();
      return (
        <button
          type="button"
          onClick={() => void exportXlsx([{ name: 'A', value: 1 }], cols, 'Test')}
        >
          Export
        </button>
      );
    }

    const { getByRole, findByText } = render(
      <ToastProvider>
        <ExportWrapper />
      </ToastProvider>,
    );

    await act(async () => {
      getByRole('button', { name: 'Export' }).click();
    });

    // The toast with "Export failed" headline must appear.
    const toastTitle = await findByText('Export failed');
    expect(toastTitle).toBeInTheDocument();
  });
});
