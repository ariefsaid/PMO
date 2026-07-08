import '@testing-library/jest-dom/vitest';
import 'jest-axe/extend-expect';

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
