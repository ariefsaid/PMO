import React, { useEffect, useMemo, useRef, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { initI18n, i18next } from './index';
import { setActiveLocale } from '@/src/lib/locale/activeLocale';
import { useResolvedLocale } from '@/src/hooks/useResolvedLocale';

/**
 * Mounts i18next and points BOTH string translation and `src/lib/format.ts` at the resolved locale.
 *
 * Sits between `<AuthProvider>` and the router in `App.tsx`: it needs the profile (above it)
 * and every string-rendering subtree sits below it.
 *
 * ⚑ BOOT ORDERING. The FIRST catalogue fetch is made in the resolved locale when there is one (a
 * cached session resolves the profile before this provider's first render), so an Indonesian user
 * starts in Indonesian instead of downloading English and switching (#2097). When the profile lands
 * later, this component re-runs, re-sets both the language and the number locale, and re-renders its
 * subtree — so nothing keeps rendering English digits under an Indonesian UI. There is no memoised
 * formatter to invalidate: `format.ts` keys its cache BY LOCALE, so the switch misses into a fresh
 * entry instead of reusing a stale one.
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

  // The locale the FIRST catalogue fetch must use. Read through a ref so the one-shot init below
  // sees the latest resolution even if the profile lands mid-init (#2097).
  const localeRef = useRef(stable.locale);
  localeRef.current = stable.locale;

  useEffect(() => {
    let active = true;
    // #2097: hand i18next the resolved locale NOW. When a cached session resolves the profile
    // before the first render, an Indonesian user's first fetch is `/locales/id/...` instead of
    // English-then-switch (which downloaded the English set and then the Indonesian one).
    void initI18n(localeRef.current).then((instance) => {
      if (!active) return;
      // The profile may have landed while the boot catalogue was in flight.
      if (instance.language !== localeRef.current) void instance.changeLanguage(localeRef.current);
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
