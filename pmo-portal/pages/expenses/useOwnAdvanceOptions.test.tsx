import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const h = vi.hoisted(() => ({
  own: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() },
}));
vi.mock('@/src/hooks/useExpenseClaims', () => ({ useOwnExpenseAdvances: () => h.own }));

import { useOwnAdvanceOptions } from './useOwnAdvanceOptions';

const row = (o: Record<string, unknown>) => ({ advanceId: 'a1', claimNumber: 'ADV-1', currency: 'IDR', outstanding: 100, ...o });

beforeEach(() => { h.own.data = undefined; h.own.isPending = false; h.own.isError = false; h.own.refetch = vi.fn(); });

describe('AC-EXP-062 useOwnAdvanceOptions', () => {
  it('AC-EXP-062 lists the own outstanding advances and reports a settled read', () => {
    h.own.data = { rows: [row({}), row({ advanceId: 'a2', claimNumber: 'ADV-2' })], truncated: false };
    const { result } = renderHook(() => useOwnAdvanceOptions());
    expect(result.current.options.map((o) => o.value)).toEqual(['a1', 'a2']);
    expect(result.current).toMatchObject({ isPending: false, isError: false });
  });
  it('AC-EXP-062 a pending read is reported as pending, not as "no advances"', () => {
    h.own.isPending = true;
    const { result } = renderHook(() => useOwnAdvanceOptions());
    expect(result.current).toMatchObject({ options: [], isPending: true, isError: false });
  });
  it('AC-EXP-062 a failed read is reported as an error and can be retried', () => {
    h.own.isError = true;
    const { result } = renderHook(() => useOwnAdvanceOptions());
    expect(result.current).toMatchObject({ options: [], isError: true });
    result.current.refetch();
    expect(h.own.refetch).toHaveBeenCalledTimes(1);
  });
  it('AC-EXP-062 an already-linked advance stays selectable even when the read failed', () => {
    h.own.isError = true;
    const { result } = renderHook(() => useOwnAdvanceOptions('linked-1'));
    expect(result.current.options).toEqual([{ value: 'linked-1', label: 'The advance already linked' }]);
  });
});
