import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({ csv: [] as string[], names: [] as string[] }));
vi.mock('@/src/lib/export/toCsv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/export/toCsv')>();
  return {
    toCsv: (t: Parameters<typeof actual.toCsv>[0]) => {
      const s = actual.toCsv(t);
      h.csv.push(s);
      return s;
    },
  };
});

import { useExport } from '../useExport';

beforeEach(() => {
  h.csv = [];
  h.names = [];
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    h.names.push(this.download);
  });
});

describe('useExport.exportTable', () => {
  it('AC-MMP-011: downloads a pre-built table as CSV under the given stem', async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => <ToastProvider>{children}</ToastProvider>;
    const { result } = renderHook(() => useExport(), { wrapper });
    await act(() => result.current.exportTable({ header: ['Currency'], body: [['IDR']] }, 'Management-pack_2026-09', 'csv'));
    expect(h.csv[0].slice(1)).toBe('Currency\r\nIDR\r\n');
    expect(h.names[0]).toMatch(/^Management-pack_2026-09_\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
