import { useEffect, useState } from 'react';

/** The `md` breakpoint (Tailwind default) — table at/above, cards below. */
const DESKTOP_QUERY = '(min-width: 768px)';

/**
 * Reads whether the viewport is at/above the `md` (768px) breakpoint.
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
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return true;
    return window.matchMedia(DESKTOP_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(DESKTOP_QUERY);
    // Re-sync on mount in case the viewport changed between the initializer and
    // the effect (the initializer runs once; the effect runs after commit).
    setIsDesktop(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isDesktop;
}
