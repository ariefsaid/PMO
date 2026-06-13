import { useCallback, useRef, useState } from 'react';

/**
 * Shared mobile-scroll tracking for the horizontal kanban boards
 * (SalesKanbanBoard + ProjectKanbanBoard). De-dups the near-verbatim
 * onScroll nearest-column tracking + `handleStageClick` programmatic
 * `scrollTo` + prefers-reduced-motion logic that both boards used to copy.
 *
 * Wiring contract (both boards):
 *  - put `scrollWrapRef` on the OUTER wrapper div (used by handleStageClick to
 *    locate the actual `.kanban-scroll` element via querySelector).
 *  - register each column div into `colRefs.current[idx]`.
 *  - pass `onScroll` DIRECTLY to `<Kanban>` (it spreads onto `.kanban-scroll`).
 *    CRITICAL: scroll events do NOT bubble — attaching onScroll to any ancestor
 *    wrapper would silently never fire on a swipe gesture (the Defect-1 bug).
 *  - feed `activeStageIndex` + `handleStageClick` into `<KanbanStageIndicator>`.
 */
export interface KanbanMobileScroll {
  /** Index of the column currently nearest the scroll-left edge. */
  activeStageIndex: number;
  /** Outer-wrapper ref — handleStageClick reads `.kanban-scroll` from inside it. */
  scrollWrapRef: React.RefObject<HTMLDivElement | null>;
  /** Per-column refs, indexed by column order. */
  colRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
  /** Pass directly to `<Kanban onScroll={...}>` (lands on `.kanban-scroll`). */
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  /** Tap a stage in the indicator → smooth-scroll that column into view. */
  handleStageClick: (index: number) => void;
}

export function useKanbanMobileScroll(): KanbanMobileScroll {
  const [activeStageIndex, setActiveStageIndex] = useState(0);
  const scrollWrapRef = useRef<HTMLDivElement>(null);
  const colRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Track which column is nearest the left edge of the scroll container.
  // NOTE: this MUST be attached to the actual `.kanban-scroll` element —
  // scroll events do not bubble, so a parent wrapper's onScroll never fires.
  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const scrollLeft = e.currentTarget.scrollLeft;
    let bestIdx = 0;
    let bestDist = Infinity;
    colRefs.current.forEach((col, i) => {
      if (!col) return;
      const dist = Math.abs(col.offsetLeft - scrollLeft);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    });
    setActiveStageIndex(bestIdx);
  }, []);

  // Programmatic scroll when the user taps a stage in the mobile indicator strip.
  const handleStageClick = useCallback((index: number) => {
    const wrap = scrollWrapRef.current;
    if (!wrap) return;
    const scrollEl = wrap.querySelector('.kanban-scroll') as HTMLElement | null;
    const col = colRefs.current[index];
    if (!scrollEl || !col) return;
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    scrollEl.scrollTo({ left: col.offsetLeft, behavior: prefersReduced ? 'instant' : 'smooth' });
    setActiveStageIndex(index);
  }, []);

  return { activeStageIndex, scrollWrapRef, colRefs, onScroll, handleStageClick };
}
