import i18next, { type BackendModule, type ReadCallback, type i18n as I18nInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { FALLBACK_LOCALE } from '@/src/lib/locale/resolveLocale';

/**
 * i18next bootstrap (FR-L10N-040/041/043, DD-I18N-1/DD-I18N-7).
 *
 * ⛔ EXACTLY THREE PACKAGES ARE APPROVED: `i18next`, `react-i18next`, and `i18next-parser` (dev).
 * No `i18next-icu`, no `i18next-http-backend`, no `i18next-browser-languagedetector`, no
 * `i18next-resources-to-backend`. That is why the lazy loader below is ~15 hand-written lines and
 * why the language is SET, never detected.
 */

/** Feature namespaces. Each maps to `public/locales/<lng>/<ns>.json`. */
export const NAMESPACES = ['common'] as const;
export const DEFAULT_NS = 'common';

/**
 * FR-L10N-043 — lazy per-locale load. i18next requests only the ACTIVE language plus `fallbackLng`,
 * so an `en` session fetches `/locales/en/*.json` and never touches `/locales/id/*.json`.
 * `public/` is copied verbatim by Vite, so catalogues are fetched JSON and never bundled — adding a
 * language must not grow the `en` bundle by a byte.
 *
 * A failed fetch reports the error to i18next rather than throwing: a catalogue that 404s degrades
 * to FR-L10N-041's English source string, it does not white-screen the app.
 */
export const catalogueBackend: BackendModule = {
  type: 'backend',
  init: () => {},
  read(language: string, namespace: string, callback: ReadCallback) {
    fetch(`/locales/${language}/${namespace}.json`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => callback(null, data))
      .catch((err: unknown) => callback(err instanceof Error ? err : new Error(String(err)), false));
  },
};

/**
 * FR-L10N-041 — a missing key renders the ENGLISH SOURCE STRING, never the raw key and never a
 * visible marker. A client must never be shown `project.header.title`.
 *
 * Two mechanisms, in order. `fallbackLng: 'en'` covers the normal case: a key absent from `id`
 * resolves out of the `en` catalogue. `parseMissingKeyHandler` is the last resort for a key absent
 * from EVERY catalogue — there is no English catalogue entry to fall back to, so the English source
 * text is whatever the call site passed as its default value (the i18next-parser convention,
 * `t('some.key', 'Some text')`). Only if even that is absent does the key itself surface, which is
 * the same condition the `en`-side completeness gate (FR-L10N-042a) makes unshippable.
 */
export function parseMissingKeyHandler(key: string, defaultValue?: string): string {
  if (defaultValue != null && defaultValue !== '') return defaultValue;
  // ⚑ `getResource` does not exist on the instance until `init()` has run, and this handler CAN be
  // reached during boot — a component rendering a key before the first catalogue resolves. Calling
  // it unguarded throws a TypeError out of a render, turning a missing translation (a cosmetic
  // problem FR-L10N-041 says to absorb) into a white screen. Guarded, not assumed.
  const fromEnglish =
    typeof i18next.getResource === 'function'
      ? i18next.getResource(FALLBACK_LOCALE, DEFAULT_NS, key)
      : undefined;
  return typeof fromEnglish === 'string' && fromEnglish !== '' ? fromEnglish : key;
}

let initPromise: Promise<I18nInstance> | null = null;

/**
 * Initialise the shared i18next instance exactly once.
 *
 * ⚑ The boot language is always `en` (FALLBACK_LOCALE) because the profile has not resolved yet.
 * `I18nProvider` re-sets it once `resolveLocale` yields an answer. The language NEVER comes from
 * `navigator.language`, `localStorage`, or a detector plugin — FR-L10N-003 makes `resolveLocale`
 * the single source, and a detector would quietly become a second one.
 */
export function initI18n(): Promise<I18nInstance> {
  if (!initPromise) {
    initPromise = i18next
      .use(catalogueBackend)
      .use(initReactI18next)
      .init({
        lng: FALLBACK_LOCALE,
        fallbackLng: FALLBACK_LOCALE,
        ns: [...NAMESPACES],
        defaultNS: DEFAULT_NS,
        // An empty translation is a MISSING one, not a deliberate blank — otherwise an untranslated
        // key in a partly-filled catalogue renders as nothing at all instead of falling back.
        returnEmptyString: false,
        parseMissingKeyHandler,
        interpolation: {
          // React escapes already; double-escaping turns an apostrophe into &#39; on screen.
          escapeValue: false,
        },
        react: { useSuspense: false },
      })
      .then(() => i18next);
  }
  return initPromise;
}

/**
 * ⛔ i18next NEVER SEES A NUMBER, A DATE, OR A MONEY FIGURE (DD-I18N-7, trap 2). The direction of
 * travel is one-way: `src/lib/format.ts` runs FIRST and i18next interpolates the finished string —
 *
 *     t('budget.remaining', { amount: formatCurrency(row.amount, row.currency) })
 *
 * The moment an amount is formatted INSIDE a message, the money path acquires the formatting
 * dependency (`i18next-icu`) it was explicitly denied. Plurals go through `Intl.PluralRules`.
 */

export { i18next };
export default i18next;
