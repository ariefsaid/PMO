import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useHomeLayout } from './useHomeLayout';

describe('home layout preference', () => {
  beforeEach(() => localStorage.removeItem('home-layout'));

  it('uses Overview when no default is requested and nothing is stored', () => {
    expect(renderHook(() => useHomeLayout()).result.current.homeLayout).toBe('overview');
  });

  it('uses Overview when no default is requested and the stored value is unknown', () => {
    localStorage.setItem('home-layout', 'compact-grid');
    expect(renderHook(() => useHomeLayout()).result.current.homeLayout).toBe('overview');
  });

  it('uses the caller default when nothing is stored or the stored value is unknown', () => {
    expect(renderHook(() => useHomeLayout('focused')).result.current.homeLayout).toBe('focused');
    localStorage.setItem('home-layout', 'compact-grid');
    expect(renderHook(() => useHomeLayout('focused')).result.current.homeLayout).toBe('focused');
  });

  it('keeps an explicit Overview choice', () => {
    localStorage.setItem('home-layout', 'overview');
    expect(renderHook(() => useHomeLayout('focused')).result.current.homeLayout).toBe('overview');
  });

  it('reads a stored Focused choice', () => {
    localStorage.setItem('home-layout', 'focused');
    expect(renderHook(() => useHomeLayout()).result.current.homeLayout).toBe('focused');
  });

  it('persists a choice on this device and updates every control using it', () => {
    const first = renderHook(() => useHomeLayout());
    const second = renderHook(() => useHomeLayout());
    act(() => first.result.current.setHomeLayout('focused'));
    expect(localStorage.getItem('home-layout')).toBe('focused');
    expect(second.result.current.homeLayout).toBe('focused');
    act(() => second.result.current.setHomeLayout('overview'));
    expect(first.result.current.homeLayout).toBe('overview');
  });

  it('follows a change made in another tab', () => {
    const { result } = renderHook(() => useHomeLayout());
    act(() => { localStorage.setItem('home-layout', 'focused'); window.dispatchEvent(new StorageEvent('storage', { key: 'home-layout', newValue: 'focused' })); });
    expect(result.current.homeLayout).toBe('focused');
  });
});
