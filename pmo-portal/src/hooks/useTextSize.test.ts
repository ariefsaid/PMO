import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useTextSize } from './useTextSize';

describe('text size preference', () => {
  beforeEach(() => {
    delete document.documentElement.dataset.textSize;
    localStorage.removeItem('text-size');
  });

  it('responds to a preference changed in another tab', () => {
    const { result } = renderHook(() => useTextSize());
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'text-size', newValue: 'large' })));
    expect(result.current.textSize).toBe('large');
    expect(document.documentElement.dataset.textSize).toBe('large');
  });

  it('applies and persists a choice and synchronizes other controls', () => {
    const first = renderHook(() => useTextSize());
    const second = renderHook(() => useTextSize());
    expect(first.result.current.textSize).toBe('default');
    act(() => first.result.current.setTextSize('larger'));
    expect(document.documentElement.dataset.textSize).toBe('larger');
    expect(localStorage.getItem('text-size')).toBe('larger');
    expect(second.result.current.textSize).toBe('larger');
    act(() => second.result.current.setTextSize('default'));
    expect(first.result.current.textSize).toBe('default');
  });
});
