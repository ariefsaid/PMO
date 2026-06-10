import '@testing-library/jest-dom/vitest';

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
      matches: /min-width:\s*768px/.test(query),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
