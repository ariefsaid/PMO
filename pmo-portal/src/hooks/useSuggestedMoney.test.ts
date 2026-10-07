import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { formatMoneyInputValue } from '@/src/lib/format';
import { useSuggestedMoney } from './useSuggestedMoney';

function useHarness(suggested: number | null, enabled: boolean) {
  const [raw, setRaw] = useState('');
  const { markTouched } = useSuggestedMoney(suggested, raw, setRaw, enabled);
  return { raw, setRaw, markTouched };
}

describe('useSuggestedMoney (#876 slice 2, DD-VWH-17)', () => {
  it('AC-VWH-030 follows the suggestion until the user edits, then never overwrites', () => {
    const { result, rerender } = renderHook(({ s }) => useHarness(s, true), { initialProps: { s: 110000 as number | null } });
    expect(result.current.raw).toBe(formatMoneyInputValue(110000));
    rerender({ s: 220000 });
    expect(result.current.raw).toBe(formatMoneyInputValue(220000));
    act(() => { result.current.markTouched(); result.current.setRaw('5'); });
    rerender({ s: 330000 });
    expect(result.current.raw).toBe('5');
  });

  it('AC-VWH-030 a null suggestion or a disabled field writes nothing', () => {
    const { result: none } = renderHook(() => useHarness(null, true));
    expect(none.current.raw).toBe('');
    const { result: off } = renderHook(() => useHarness(110000, false));
    expect(off.current.raw).toBe('');
  });
});
