/**
 * JS-started motion (scrollTo/scrollIntoView behaviour strings, WAAPI) is out of reach of
 * the CSS `prefers-reduced-motion` rule (index.css), so those call sites ask here.
 * #2126 (animation audit slice M5); closes the smooth-scroll bullet of #2093.
 */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export const scrollBehavior = (): ScrollBehavior => (prefersReducedMotion() ? 'instant' : 'smooth');
