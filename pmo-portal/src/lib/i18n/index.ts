import i18next, { type BackendModule, type ReadCallback, type i18n as I18nInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { FALLBACK_LOCALE, isUsableLocaleTag } from '@/src/lib/locale/resolveLocale';

/**
 * i18next bootstrap (FR-L10N-040/041/043, DD-I18N-1/DD-I18N-7).
 *
 * ⛔ EXACTLY THREE PACKAGES ARE APPROVED: `i18next`, `react-i18next`, and `i18next-parser` (dev).
 * No `i18next-icu`, no `i18next-http-backend`, no `i18next-browser-languagedetector`, no
 * `i18next-resources-to-backend`. That is why the lazy loader below is ~15 hand-written lines and
 * why the language is SET, never detected.
 */

/** Feature namespaces. Each maps to `public/locales/<lng>/<ns>.json`. */
export const NAMESPACES = ['common', 'import', 'crm', 'sales', 'projectTabs', 'projects', 'finance', 'financeHub', 'dashboard', 'project', 'procurement', 'expenseClaims', 'meetingCreate', 'recordFolders', 'documentViewer', 'costAttribution', 'procurementRecord', 'procurementList', 'procurementCreate', 'assistantPanel', 'viewBuilder', 'profilePreferences', 'stock', 'imprest', 'equipment', 'timeAndMaterials', 'boardDrag', 'lostReason', 'administration', 'plans', 'tasks', 'calendar', 'meetings', 'timesheets', 'status', 'home', 'auth', 'legal'] as const;
export const DEFAULT_NS = 'common';

/**
 * The namespaces RESIDENT AT BOOT (#2097). Only `common` — the app chrome, and the one catalogue
 * every route's first paint can need. Everything else is fetched on demand:
 *
 *  - `useTranslation('<ns>')` loads `<ns>` when its component mounts (react-i18next's `loadNamespaces`);
 *  - the route preload rules in `App.tsx` start the ROUTE's catalogue in parallel with its code
 *    chunk, so the first paint of that route already has it;
 *  - `parseMissingKeyHandler` below is the backstop for a `t('<ns>:key')` reached through a bare
 *    `useTranslation()`: it resolves the English catalogue entry (never a raw key) AND asks for the
 *    namespace, so the next render has the active language's text.
 *
 * ⚑ Why it matters: passing all 32 namespaces to `init` made every cold load — on EVERY route —
 * fetch 32 JSON files (~500 KB raw / ~126 KB gzip in `en`), competing with the route chunk and the
 * first data reads. A namespace nobody is looking at is pure latency.
 */
export const BOOT_NAMESPACES: readonly string[] = [DEFAULT_NS];

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
 * Build the missing-key handler for an i18next INSTANCE. The shipped handler is the one below
 * (`parseMissingKeyHandler`, bound to the app's singleton); the factory exists so a test can drive
 * the on-demand path against an isolated instance — a pre-initialised singleton (the test setup's)
 * reports every namespace as already loaded, which would make the test vacuous.
 */
export function createParseMissingKeyHandler(
  instance: I18nInstance,
): (key: string, defaultValue?: string) => string {
  // Per-instance, so two instances never suppress each other's on-demand load.
  const requestedNamespaces = new Set<string>();

  const loadOnDemand = (namespace: string): void => {
    if (namespace === DEFAULT_NS || requestedNamespaces.has(namespace)) return;
    // Before `init()` there is nothing to load INTO; the boot catalogue is already on its way.
    if (!instance.isInitialized) return;
    if (typeof instance.loadNamespaces !== 'function' || typeof instance.hasLoadedNamespace !== 'function') return;
    if (instance.hasLoadedNamespace(namespace)) return;
    requestedNamespaces.add(namespace);
    // Fire-and-forget: i18next de-dupes concurrent requests for a namespace, a failed catalogue is
    // recorded as attempted (no retry storm), and a 404 still leaves FR-L10N-041's English text up.
    void instance.loadNamespaces(namespace).catch(() => undefined);
  };

  return (key: string, defaultValue?: string): string => {
    // `appendNamespaceToMissingKey` prefixes the key with its namespace and `:`. A plain key (no
    // separator, or a call site passing its key straight to this handler) belongs to `common`.
    const separator = key.indexOf(':');
    const namespace = separator > 0 ? key.slice(0, separator) : DEFAULT_NS;
    const bareKey = separator > 0 ? key.slice(separator + 1) : key;
    // ⚑ The catalogue is requested FIRST, even when the call site supplied a default string.
    // Returning the default without asking for the namespace would leave a route permanently
    // English — the default is a first-paint fallback, not the answer. (This is the `t('crm:x',
    // 'Companies')`-through-a-bare-`useTranslation()` case, which is most of the app.)
    loadOnDemand(namespace);
    if (defaultValue != null && defaultValue !== '') return defaultValue;
    // ⚑ `getResource` does not exist on the instance until `init()` has run, and this handler CAN be
    // reached during boot — a component rendering a key before the first catalogue resolves. Calling
    // it unguarded throws a TypeError out of a render, turning a missing translation (a cosmetic
    // problem FR-L10N-041 says to absorb) into a white screen. Guarded, not assumed.
    const resource =
      typeof instance.getResource === 'function'
        ? instance.getResource(FALLBACK_LOCALE, namespace, bareKey) ??
          (namespace === DEFAULT_NS ? undefined : instance.getResource(FALLBACK_LOCALE, DEFAULT_NS, bareKey))
        : undefined;
    if (typeof resource === 'string' && resource !== '') return resource;
    // The last resort is the key WITHOUT its namespace prefix: `companies.title` reads like a
    // stray identifier, `crm:companies.title` reads like an implementation detail on the screen.
    return bareKey;
  };
}

/** The app's handler — bound to the shared instance `initI18n` initialises. */
export const parseMissingKeyHandler = createParseMissingKeyHandler(i18next);

let initPromise: Promise<I18nInstance> | null = null;

/**
 * The i18next init options, as a value. Exported so `initI18n` and an isolated test instance run the
 * SAME config — a test that re-typed these options would certify the test, not the app.
 */
export function i18nInitOptions(
  locale: string = FALLBACK_LOCALE,
  instance: I18nInstance = i18next,
): Record<string, unknown> {
  const bootLocale = locale && isUsableLocaleTag(locale) ? locale : FALLBACK_LOCALE;
  return {
    lng: bootLocale,
    fallbackLng: FALLBACK_LOCALE,
    fallbackNS: DEFAULT_NS,
    // #2097: the shell's catalogue only. Feature catalogues are fetched on demand (BOOT_NAMESPACES)
    // — this list is what every cold load used to pay for, on every route.
    ns: [...BOOT_NAMESPACES],
    defaultNS: DEFAULT_NS,
    // An empty translation is a MISSING one, not a deliberate blank — otherwise an untranslated
    // key in a partly-filled catalogue renders as nothing at all instead of falling back.
    returnEmptyString: false,
    // Bound to the same instance these options initialise, so the on-demand load lands there.
    parseMissingKeyHandler: createParseMissingKeyHandler(instance),
    // The handler needs the key's namespace to read the right catalogue and to request a feature
    // namespace that has not arrived yet (createParseMissingKeyHandler above).
    appendNamespaceToMissingKey: true,
    interpolation: {
      // React escapes already; double-escaping turns an apostrophe into &#39; on screen.
      escapeValue: false,
    },
    react: {
      useSuspense: false,
      // react-i18next's default is `languageChanged` only. An on-demand catalogue lands AFTER the
      // first paint, so without `loaded` the subscribers would keep rendering the English fallback
      // until some unrelated state changed.
      bindI18n: 'languageChanged loaded',
    },
  };
}

/**
 * Initialise the shared i18next instance exactly once.
 *
 * ⚑ THE BOOT LANGUAGE (#2097). The first call uses the locale `resolveLocale` already produced —
 * when a cached session resolves the profile before the first render, a user whose preference is
 * Indonesian now fetches `/locales/id/*` first instead of downloading English and switching. A call
 * with no argument keeps the documented fallback: the profile has not resolved yet, so a cold
 * boot's first frame is `en`. The language NEVER comes from `navigator.language`, `localStorage`, or
 * a detector plugin — FR-L10N-003 makes `resolveLocale` the single source, and a detector would
 * quietly become a second one. (This parameter is that same resolution, handed over earlier.)
 *
 * The instance is a singleton: a later call with a different locale does NOT re-init; it returns
 * the existing promise, and `I18nProvider` switches language on the live instance.
 */
export function initI18n(locale: string = FALLBACK_LOCALE): Promise<I18nInstance> {
  if (!initPromise) {
    initPromise = i18next
      .use(catalogueBackend)
      .use(initReactI18next)
      .init(i18nInitOptions(locale))
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
