/**
 * useKanbanMobileScroll — unit tests for the shared mobile-scroll tracking hook
 * extracted from SalesKanbanBoard / ProjectKanbanBoard (de-dup, code-quality fix #4).
 *
 * Verifies the real behavior both boards depend on:
 *  - onScroll picks the column nearest the scroll-left edge → activeStageIndex
 *  - handleStageClick locates `.kanban-scroll` and programmatically scrollTo's the column
 *  - prefers-reduced-motion switches the scroll behavior to 'instant'
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useKanbanMobileScroll } from './useKanbanMobileScroll';

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

/** Wire colRefs to fake columns at the given offsetLefts. */
function attachColumns(
  result: { current: ReturnType<typeof useKanbanMobileScroll> },
  offsets: number[],
) {
  offsets.forEach((offsetLeft, i) => {
    result.current.colRefs.current[i] = { offsetLeft } as HTMLDivElement;
  });
}

describe('useKanbanMobileScroll', () => {
  it('onScroll sets activeStageIndex to the column nearest the scroll-left edge', () => {
    const { result } = renderHook(() => useKanbanMobileScroll());
    attachColumns(result, [0, 300, 600]);

    act(() => {
      result.current.onScroll({
        currentTarget: { scrollLeft: 320 },
      } as unknown as React.UIEvent<HTMLDivElement>);
    });
    // 320 is closest to column 1 (offset 300)
    expect(result.current.activeStageIndex).toBe(1);

    act(() => {
      result.current.onScroll({
        currentTarget: { scrollLeft: 590 },
      } as unknown as React.UIEvent<HTMLDivElement>);
    });
    expect(result.current.activeStageIndex).toBe(2);
  });

  it('handleStageClick scrolls .kanban-scroll to the column offset (smooth by default)', () => {
    const { result } = renderHook(() => useKanbanMobileScroll());

    const scrollTo = vi.fn();
    const scrollEl = { scrollTo } as unknown as HTMLElement;
    const wrap = { querySelector: vi.fn().mockReturnValue(scrollEl) } as unknown as HTMLDivElement;
    result.current.scrollWrapRef.current = wrap;
    attachColumns(result, [0, 300, 600]);

    act(() => result.current.handleStageClick(2));

    expect(scrollTo).toHaveBeenCalledWith({ left: 600, behavior: 'smooth' });
    expect(result.current.activeStageIndex).toBe(2);
  });

  it('handleStageClick uses instant scroll when prefers-reduced-motion is set', () => {
    (window.matchMedia as ReturnType<typeof vi.fn>).mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const { result } = renderHook(() => useKanbanMobileScroll());

    const scrollTo = vi.fn();
    const scrollEl = { scrollTo } as unknown as HTMLElement;
    const wrap = { querySelector: vi.fn().mockReturnValue(scrollEl) } as unknown as HTMLDivElement;
    result.current.scrollWrapRef.current = wrap;
    attachColumns(result, [0, 300]);

    act(() => result.current.handleStageClick(1));

    expect(scrollTo).toHaveBeenCalledWith({ left: 300, behavior: 'instant' });
  });

  it('handleStageClick is a no-op when the wrapper or column ref is missing', () => {
    const { result } = renderHook(() => useKanbanMobileScroll());
    // No wrapper attached → must not throw.
    expect(() => act(() => result.current.handleStageClick(0))).not.toThrow();
  });
});
