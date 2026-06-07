import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { readPipelineView, writePipelineView, usePipelineView } from './usePipelineView';
import { VIEWS_STORAGE_KEY } from './viewStorage';

describe('pipeline view persistence (AC-SP-201)', () => {
  beforeEach(() => sessionStorage.clear());

  it('AC-SP-201: defaults to kanban when nothing is stored', () => {
    expect(readPipelineView()).toBe('kanban');
  });

  it('AC-SP-201: round-trips through sessionStorage under VIEWS_STORAGE_KEY', () => {
    writePipelineView('table');
    expect(readPipelineView()).toBe('table');
    const raw = sessionStorage.getItem(VIEWS_STORAGE_KEY);
    expect(raw).toContain('table');
    // does not clobber other view keys in the same map
    expect(JSON.parse(raw!).pipeline).toBe('table');
  });

  it('AC-SP-201: preserves sibling view keys in the views map', () => {
    sessionStorage.setItem(VIEWS_STORAGE_KEY, JSON.stringify({ projects: 'grid' }));
    writePipelineView('table');
    const parsed = JSON.parse(sessionStorage.getItem(VIEWS_STORAGE_KEY)!);
    expect(parsed.projects).toBe('grid');
    expect(parsed.pipeline).toBe('table');
  });

  it('AC-SP-201: falls back to kanban on parse failure', () => {
    sessionStorage.setItem(VIEWS_STORAGE_KEY, '{not json');
    expect(readPipelineView()).toBe('kanban');
  });

  it('AC-SP-201: ignores an out-of-range stored value', () => {
    sessionStorage.setItem(VIEWS_STORAGE_KEY, JSON.stringify({ pipeline: 'galaxy' }));
    expect(readPipelineView()).toBe('kanban');
  });

  it('AC-SP-201: usePipelineView hook persists the choice across the setter', () => {
    const { result } = renderHook(() => usePipelineView());
    expect(result.current[0]).toBe('kanban');
    act(() => result.current[1]('table'));
    expect(result.current[0]).toBe('table');
    expect(readPipelineView()).toBe('table');
  });

  it('AC-SP-201: write survives a sessionStorage exception without throwing', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => writePipelineView('table')).not.toThrow();
    spy.mockRestore();
  });
});
