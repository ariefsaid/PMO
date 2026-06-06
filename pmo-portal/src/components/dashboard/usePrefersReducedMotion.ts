import { useEffect, useState } from 'react';

/**
 * Tracks the `prefers-reduced-motion: reduce` media query so charts can disable
 * entrance animation for users who opt out (ui-ux-pro-max §10 animation-optional
 * / DESIGN.md reduced-motion). Data is readable immediately either way.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
