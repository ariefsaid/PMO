import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProcurementWithholding } from './useProcurementWithholding';

describe('useProcurementWithholding', () => {
  it('opens and closes the record form for a bill', () => {
    const { result } = renderHook(() => useProcurementWithholding());
    const invoice = { id: 'inv-1' } as never;
    act(() => result.current.openRecord(invoice));
    expect(result.current.recordInvoice).toBe(invoice);
    act(() => result.current.closeRecord());
    expect(result.current.recordInvoice).toBeNull();
  });

  it('returns focus to the opener when the history closes, but not when a slip is opened from it', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { result } = renderHook(() => useProcurementWithholding());
    act(() => result.current.openHistory('inv-1'));
    expect(result.current.historyInvoiceId).toBe('inv-1');
    opener.blur();
    act(() => result.current.dismissHistory());
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(document.activeElement).not.toBe(opener);
    opener.focus();
    act(() => result.current.openHistory('inv-1'));
    opener.blur();
    act(() => result.current.closeHistory());
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(result.current.historyInvoiceId).toBeNull();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
