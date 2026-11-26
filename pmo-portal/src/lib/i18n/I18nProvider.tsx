import React, { useEffect, useMemo, useRef, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { DEFAULT_NS, initI18n, i18next } from './index';
import { setActiveLocale, setActiveOrgTimezone } from '@/src/lib/locale/activeLocale';
import { useResolvedLocale, useOrgBusinessTimezone } from '@/src/hooks/useResolvedLocale';
import { useApplyOrgTerminology } from '@/src/hooks/useOrgTerminology';
import { useApplyOrgRoleNames } from '@/src/hooks/useOrgRoleNames';
import { useApplyOrgStageNames } from '@/src/hooks/useOrgStageNames';

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
  // #2529: the org's renamed terms, applied by the terminology plugin in `index.ts`.
  useApplyOrgTerminology();
  // #2712: the org's own role names, read by the role picker, directory and confirmations.
  useApplyOrgRoleNames();
  // #2906: the org's own stage names.
  useApplyOrgStageNames(resolved.locale);
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
  const orgTimezone = useOrgBusinessTimezone();
  setActiveOrgTimezone(orgTimezone);

  // Apply language switches in order: a slower catalogue requested by an older profile must
  // finish before the current profile is applied. Superseded queued work is discarded.
  const languageQueue = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    // Document metadata follows the resolved profile without waiting for feature catalogues.
    if (typeof document !== 'undefined') document.documentElement.lang = stable.locale;
    let active = true;
    // Start the singleton bootstrap in the resolved locale immediately (#2097).
    const initialized = initI18n(stable.locale);
    languageQueue.current = languageQueue.current.then(async () => {
      const instance = await initialized;
      if (!active) return;
      if (instance.language !== stable.locale) await instance.changeLanguage(stable.locale);
      if (!active) return;
      markCataloguesLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [stable.locale]);

  // i18next resolves its first catalogue in a microtask-plus-fetch. Rendering the tree meanwhile is
  // correct — `useSuspense: false` plus FR-L10N-041's fallback means a not-yet-loaded key renders
  // its English source string rather than a raw key or a blank.
  // Passing `defaultNS` prevents any `useTranslation()` rendered before `initI18n` from falling
  // back to i18next's default `'translation'` namespace and fetching `/locales/*/translation.json`.
  return <I18nextProvider i18n={i18next} defaultNS={DEFAULT_NS}>{/* ⚑ keyed on the organisation's timezone: a dialog's default day is read once on mount, and the organisation defaults land after
          first paint, so a form opened before they did would keep the UTC day. One remount, once, when the timezone changes. */}
      <React.Fragment key={orgTimezone}>{children}</React.Fragment>
    </I18nextProvider>;
};
