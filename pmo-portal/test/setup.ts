import '@testing-library/jest-dom/vitest';

// jsdom implements no layout/scroll APIs. Element.scrollIntoView is used by
// keyboard-driven list components (e.g. Combobox active-option tracking); shim
// it as a no-op so production code can call it and tests can spy on it.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
