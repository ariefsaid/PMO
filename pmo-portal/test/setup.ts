import '@testing-library/jest-dom/vitest';
import 'jest-axe/extend-expect';
import { createElement } from 'react';
import { vi } from 'vitest';

// Projects page suites predating the collection-money query intentionally render
// without a QueryClient. Their concerns are independent of this new read seam;
// dedicated collection-hook and Projects behavior tests exercise the real hook.
vi.mock('@/src/hooks/useProjectsMoneyCollection', () => ({
  useProjectsMoneyCollection: () => ({ data: undefined, isPending: true, isError: false }),
}));

// The org default-library card reads auth + a Microsoft connection query that the many Integrations
// view suites do not provide (and which they do not test). Its own suite un-mocks it with
// `vi.unmock`; the view suites need only to know it is mounted on the page.
// Same for the budget evidence panel (it needs a QueryClient + auth the page suites do not provide);
// ProjectBudget.test.tsx asserts the mount through this stub's data attributes.
vi.mock('@/src/components/m365/BudgetDocumentLinks', () => ({
  BudgetDocumentLinks: ({ versionId, status }: { versionId: string; status: string }) =>
    createElement('div', { 'data-testid': 'budget-evidence-mount', 'data-version': versionId, 'data-status': status }),
}));
vi.mock('@/src/components/integrations/M365DefaultLibraryCard', () => ({
  M365DefaultLibraryCard: () => createElement('div', { 'data-testid': 'm365-default-library-stub' }),
}));

// Some local Node/Vitest combinations expose jsdom but do not install a usable
// localStorage global. Several app primitives persist per-device UI prefs, so
// unit tests need a Storage-compatible shim when the environment lacks one.
function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };
}

if (typeof window !== 'undefined') {
  let storage: Storage | undefined;
  try {
    storage = window.localStorage;
  } catch {
    storage = undefined;
  }

  if (!storage) {
    storage = createMemoryStorage();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: storage,
    });
  }

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
}

// jsdom implements no layout/scroll APIs. Element.scrollIntoView is used by
// keyboard-driven list components (e.g. Combobox active-option tracking); shim
// it as a no-op so production code can call it and tests can spy on it.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

// Same class of gap: BlockNote's side menu (MinutesEditor) calls
// `document.elementsFromPoint` from its capture-phase mousemove handler, and
// jsdom has no implementation. Until 2026-10-31 the suite got axe-core's
// polyfill as an invisible side effect of the global `jest-axe/extend-expect`
// import (removed for speed — it cost ~72 ms/file). An empty result is the
// faithful jsdom answer — axe's own polyfill also resolves to [] here, because
// jsdom's elementFromPoint does no layout — and sends BlockNote down its
// existing menu-hide path, exactly as before.
if (typeof document !== 'undefined' && !document.elementsFromPoint) {
  document.elementsFromPoint = () => [];
}

// jsdom has no `window.matchMedia`. The DataTable (and other responsive
// primitives via useIsDesktop) read it synchronously at first paint to pick the
// single render branch. Default the mock to DESKTOP — `matches: true` for the
// `(min-width: 768px)` query — so every test renders the desktop `<table>`
// branch by default (a single DOM copy of each cell, matching how the suite was
// originally written). Tests that need the mobile card branch override this with
// a per-test stub (see DataTable.mobile.test.tsx).
//
// addEventListener/removeEventListener are no-op stubs: jsdom never changes the
// viewport mid-test, so the change-listener never fires. Hooks/tests that want
// to exercise the change path stub matchMedia themselves (e.g.
// usePrefersReducedMotion.test.ts) and restore it afterwards.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      // Return true for any min-width query with a value ≤ the default desktop viewport
    // (≥768px queries all pass in a desktop jsdom context). The 1440 cap matches the
    // AssistantPanel 1024px threshold and any other responsive breakpoint we use.
    matches: (() => {
      const m = /min-width:\s*(\d+)px/.exec(query);
      return m ? parseInt(m[1], 10) <= 1440 : false;
    })(),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// ADR-0042 §4: build-time version identity (`vite.config.ts` `define`). Vite's
// `define` replacement does NOT run under Vitest, so the bare `__*__` tokens
// referenced at module-eval in `src/lib/version.ts` would throw ReferenceError
// in any test that transitively imports it (AppShell/LoginPage render
// <AppVersion>). Default them here so the broader suite stays green; the
// dedicated `version.test.ts` / `AppVersion.test.tsx` override per-test via
// `vi.stubGlobal` + `vi.resetModules` + a fresh dynamic import.
(globalThis as Record<string, unknown>).__APP_VERSION__ ??= '0.0.0-test';
(globalThis as Record<string, unknown>).__GIT_SHA__ ??= 'testsha';
(globalThis as Record<string, unknown>).__BUILD_TIME__ ??= '1970-01-01T00:00:00.000Z';

// ── i18next test instance (M12, #526 review) ───────────────────────────────
// Without an initialised instance, react-i18next's notReady `t` returns the default string and
// SILENTLY DROPS the options bag — `t('k', 'Share with {{name}}', { name })` rendered the literal
// braces in every unit test, which is why interpolated keys were banned (the Companies.tsx notes)
// and values were string-concatenated instead. Initialising a minimal synchronous instance here
// makes `t` behave in tests as it does at runtime: a missing key resolves to its defaultValue WITH
// interpolation applied. Resources stay empty on purpose — the suite asserts the English source
// strings the call sites carry, never a catalogue (catalogues are fetched JSON, FR-L10N-043).
import i18nextTest from 'i18next';
import { initReactI18next } from 'react-i18next';

void i18nextTest.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { common: {} } },
  defaultNS: 'common',
  initImmediate: false, // synchronous init — no async gap before the first render
  interpolation: { escapeValue: false }, // React escapes; double-escaping corrupts "D&B" etc.
});

// ── Locale pin (AC-L10N-061) ───────────────────────────────────────────────
// Every formatter in src/lib/format.ts now reads the resolved locale out of a module holder, so
// without an explicit pin the suite would certify whatever locale the holder happened to be left
// in. 53 test files assert `$`-shaped money and several assert "Mon D, YYYY" dates; pinned here so
// those assertions state a CHOSEN locale rather than inheriting one — an unpinned suite either goes
// red for the wrong reason or, worse, stays green while proving nothing.
//
// `afterEach` restores it so a test that switches locale to exercise `id` cannot leak that choice
// into the next file's money assertions.
import { setActiveLocale } from '@/src/lib/locale/activeLocale';

const TEST_LOCALE = { locale: 'en', numberLocale: 'en-US', timezone: 'UTC' };
setActiveLocale(TEST_LOCALE);
afterEach(() => {
  setActiveLocale(TEST_LOCALE);
});
