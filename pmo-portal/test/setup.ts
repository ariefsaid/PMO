import '@testing-library/jest-dom/vitest';
import 'jest-axe/extend-expect';

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
