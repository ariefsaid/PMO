// ── Background inert (AC-A11Y-MODAL-001) ────────────────────────────────────
// `aria-modal="true"` is ADVISORY: it does not remove the background from the tab
// order, so focus that starts OUTSIDE the dialog (e.g. dumped on <body> by a failed
// save) walks straight into the app behind the scrim, and a screen reader can still
// browse it. `inert` on the app-shell root is the platform-native fix — it removes the
// background from the tab order AND the a11y tree AND blocks pointer events in one
// attribute. The refcount is MODULE-level so every modal primitive (EntityFormModal,
// ConfirmDialog) shares one count: a discard-confirm stacked on a form dialog must not
// un-inert the form's background when only the inner one closes. Scoped to the shell
// root (not <body>'s children) so the toast host and other body-level portals — where
// these dialogs themselves render — stay reachable and announceable.
const APP_SHELL_SELECTOR = '[data-app-shell="root"]';
let backgroundInertRefs = 0;

/**
 * Mark the app shell `inert` and return an idempotent release function. Call from an effect
 * while a modal dialog is open and return the release as the cleanup. No-ops (returns a no-op
 * release) when there is no app shell, e.g. an isolated component test or the login screen.
 */
export function acquireBackgroundInert(): () => void {
  const shell = document.querySelector<HTMLElement>(APP_SHELL_SELECTOR);
  if (!shell) return () => {};
  if (backgroundInertRefs === 0) shell.setAttribute('inert', '');
  backgroundInertRefs += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    backgroundInertRefs = Math.max(0, backgroundInertRefs - 1);
    if (backgroundInertRefs === 0) shell.removeAttribute('inert');
  };
}
