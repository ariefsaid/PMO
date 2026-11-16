import React from 'react';
import i18next from 'i18next';

/**
 * In-layout loading fallback shown while a lazy route chunk is fetching.
 * Rendered inside the app shell (after Sidebar/Header) so layout doesn't jump.
 * role="status" makes it accessible per WCAG AA (live region for screen readers).
 *
 * Colour comes from DESIGN.md tokens only: the label is `muted-foreground` (10.96:1 on the
 * canvas, 12.01:1 on a card) — it was Tailwind `gray-500`, which measured 4.41:1 on the
 * canvas and failed AA. The spinner is `primary` (4.74:1 on the canvas, a graphical mark).
 */
/**
 * This IS the Suspense fallback, so it must never suspend itself: a hook-based translation would
 * throw a promise while catalogues load and leave the whole app blank. Read the live instance and
 * fall back to English until it is ready.
 */
const t = (key: string, fallback: string): string => (i18next.isInitialized ? i18next.t(key, { ns: 'common', defaultValue: fallback }) : fallback);

export const LoadingFallback: React.FC = () => {
  return (
  <div
    role="status"
    aria-label={t('ui.loadingPage.label', 'Loading page')}
    className="flex items-center justify-center h-full w-full min-h-[200px]"
  >
    <div className="flex flex-col items-center gap-3 text-muted-foreground">
      <svg
        className="animate-spin h-8 w-8 text-primary"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
      <span className="text-sm font-medium">{t('ui.listState.loading', 'Loading…')}</span>
    </div>
  </div>
  );
};

export default LoadingFallback;
