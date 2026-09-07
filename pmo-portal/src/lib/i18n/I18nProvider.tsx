import React, { useEffect, useMemo, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { initI18n, i18next } from './index';
import { setActiveLocale } from '@/src/lib/locale/activeLocale';
import { useResolvedLocale } from '@/src/hooks/useResolvedLocale';

/**
 * Mounts i18next and points BOTH string translation and `src/lib/format.ts` at the resolved locale.
 *
 * Sits between `<AuthProvider>` and `<BrowserRouter>` in `App.tsx`: it needs the profile (above it)
 * and every string-rendering subtree sits below it.
 *
 * ⚑ BOOT ORDERING. Before the profile resolves the language is `en` and the number locale is
 * `en-US`. When the profile lands this component re-runs, re-sets both, and re-renders its subtree —
 * so nothing keeps rendering English digits under an Indonesian UI. There is no memoised formatter
 * to invalidate: `format.ts` keys its cache BY LOCALE, so the switch misses into a fresh entry
 * instead of reusing a stale one.
 *
 * ⛔ The language is SET here from `resolveLocale`'s output and is never detected. No
 * `navigator.language`, no `localStorage`, no detector plugin (FR-L10N-003).
 */
export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const resolved = useResolvedLocale();
  // A re-render trigger, not a gate. Its only job is to re-render the subtree once the first
  // catalogue has landed, so keys that rendered as their English source string during boot are
  // replaced by their catalogue entry. Deliberately NOT used to withhold children: blanking the
  // app until a JSON fetch resolves is a worse failure than one paint of English.
  const [, markCataloguesLoaded] = useState(false);

  // Identity-stable across renders that did not actually change the locale, so the effect below
  // does not re-fire (and re-request a catalogue) on every unrelated auth-context update.
  const { locale, numberLocale, timezone } = resolved;
  const stable = useMemo(
    () => ({ locale, numberLocale, timezone }),
    [locale, numberLocale, timezone],
  );

  // Synchronous, not an effect: a formatter called during THIS render must already see the new
  // locale. An effect would let one paint escape with the previous locale's separators.
  setActiveLocale(stable);

  useEffect(() => {
    let active = true;
    void initI18n().then(() => {
      if (!active) return;
      markCataloguesLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (i18next.language !== stable.locale) void i18next.changeLanguage(stable.locale);
    // FR-L10N-014 / AC-L10N-031 — the document language tracks the resolved locale so screen
    // readers pick the right voice and the browser offers the right translation prompt.
    // `index.html` ships a static lang="en"; this is what makes it true after resolution.
    // ⚑ `lang` only. NOT `dir`: spec §7 rules RTL out deliberately, not "for later".
    if (typeof document !== 'undefined') document.documentElement.lang = stable.locale;
  }, [stable]);

  // i18next resolves its first catalogue in a microtask-plus-fetch. Rendering the tree meanwhile is
  // correct — `useSuspense: false` plus FR-L10N-041's fallback means a not-yet-loaded key renders
  // its English source string rather than a raw key or a blank.
  return <I18nextProvider i18n={i18next}>{children}</I18nextProvider>;
};
