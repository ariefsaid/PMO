import { useEffect, useState } from 'react';

/** The `md` breakpoint (Tailwind default) — desktop at/above, mobile below. */
const DEFAULT_DESKTOP_BREAKPOINT = 768;

/**
 * Reads whether the viewport is at/above `minWidth` (defaults to `md`, 768px).
 *
 * The DataTable single-renders EITHER the desktop `<table>` OR the mobile card
 * list off this value (never both in the DOM at once), so the initial value MUST
 * be correct at first paint — otherwise a mobile user would flash the wrong
 * branch. The `useState` initializer therefore reads `matchMedia(...).matches`
 * synchronously (no false→true flip via effect). A `change` listener keeps it in
 * sync when the viewport crosses the breakpoint (e.g. device rotation, window
 * resize) and is cleaned up on unmount.
 *
 * Guards `typeof window`/`matchMedia` undefined (SSR / non-DOM env) → defaults
 * to desktop (`true`).
 */
export function useIsDesktop(minWidth = DEFAULT_DESKTOP_BREAKPOINT): boolean {
  const query = `(min-width: ${minWidth}px)`;
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return true;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    // Re-sync on mount in case the viewport changed between the initializer and
    // the effect (the initializer runs once; the effect runs after commit).
    setIsDesktop(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return isDesktop;
}
