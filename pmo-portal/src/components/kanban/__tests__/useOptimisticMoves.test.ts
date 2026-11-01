import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useOptimisticMoves } from '../useOptimisticMoves';

describe('useOptimisticMoves', () => {
  it('holds a card in the target column, marks it saving, and releases it back (AC-DND-008 rollback seam)', () => {
    const { result } = renderHook(() => useOptimisticMoves());
    expect(result.current.columnOf('a', 'Leads')).toBe('Leads');
    act(() => result.current.hold('a', 'Tender'));
    expect(result.current.columnOf('a', 'Leads')).toBe('Tender');
    expect(result.current.stateOf('a')).toBe('held');
    act(() => result.current.save('a'));
    expect(result.current.stateOf('a')).toBe('saving');
    act(() => result.current.release('a'));
    expect(result.current.columnOf('a', 'Leads')).toBe('Leads');
    expect(result.current.stateOf('a')).toBeNull();
  });

  it('AC-DND-008: releaseAfterRender keeps the card held for one tick, then releases it (no flicker back)', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useOptimisticMoves());
      act(() => result.current.hold('a', 'Tender'));
      let done!: Promise<void>;
      act(() => { done = result.current.releaseAfterRender('a'); });
      expect(result.current.stateOf('a')).toBe('held');
      await act(async () => { await vi.runAllTimersAsync(); await done; });
      expect(result.current.stateOf('a')).toBeNull();
    } finally { vi.useRealTimers(); }
  });
});
