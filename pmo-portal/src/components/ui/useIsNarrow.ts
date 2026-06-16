import { useEffect, useState } from 'react';

/** The `sm` breakpoint edge (Tailwind default) — narrow below 640px, ≥640px above. */
const NARROW_QUERY = '(max-width: 639px)';

/**
 * Reads whether the viewport is BELOW the `sm` (640px) breakpoint.
 *
 * Used by the Project Gantt to swap the cramped MS-Project split layout for a
 * friendly "view on a wider screen" notice on phones (defect D1: at 390px the
 * 260px task table eats the width and leaves the timeline an unusable sliver).
 * Sibling of `useIsDesktop` (which keys off `md`/768px) — kept separate because
 * this breakpoint (sm/640px) is distinct and `useIsDesktop` has other consumers.
 *
 * Mirrors `useIsDesktop` exactly: a synchronous `useState` initializer reading
 * `matchMedia(...).matches` (so the correct branch renders at first paint — no
 * flash of the cramped Gantt before the notice), a `change` listener to re-sync
 * when the viewport crosses the breakpoint (device rotation / window resize),
 * cleaned up on unmount.
 *
 * Guards `typeof window`/`matchMedia` undefined (SSR / non-DOM env) → defaults to
 * NOT narrow (`false`), i.e. assume desktop.
 */
export function useIsNarrow(): boolean {
  const [isNarrow, setIsNarrow] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(NARROW_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(NARROW_QUERY);
    // Re-sync on mount in case the viewport changed between the initializer and
    // the effect (the initializer runs once; the effect runs after commit).
    setIsNarrow(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isNarrow;
}
