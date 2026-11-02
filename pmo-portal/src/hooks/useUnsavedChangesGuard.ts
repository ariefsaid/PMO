import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';

export interface UnsavedChangesGuardOptions {
  /** True while the page holds edits that would be lost by leaving. */
  dirty: boolean;
  /**
   * Called when an exit is held. `leave` performs the exit exactly as the user asked for it (the
   * link's own click handler with its router state, or a plain local navigation) — call it from
   * the confirm dialog's Leave; drop it on Stay.
   */
  onBlocked: (leave: () => void) => void;
  /** Also hold browser Back/Forward changes. Only enable on BrowserRouter pages that need it. */
  guardHistory?: boolean;
}

const isPlainPrimaryClick = (event: MouseEvent): boolean =>
  !event.defaultPrevented &&
  event.button === 0 &&
  !event.metaKey &&
  !event.ctrlKey &&
  !event.shiftKey &&
  !event.altKey;

const browserHistoryIndex = (): number | null => {
  const index = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof index === 'number' ? index : null;
};

/**
 * FR-MTG-040 / DD-MTG-11 — hold in-app exits while `dirty`.
 *
 * - Same-origin, same-tab `<a href>` activations are intercepted (capture phase, before React's
 *   root listener). Modified clicks, `target` other than `_self`, `download` and cross-origin
 *   links are left to the browser — they do not discard this tab's edits.
 * - `beforeunload` is cancelled so reload / tab close / external URL get the browser's prompt.
 * - `guardHistory` holds BrowserRouter Back/Forward changes and replays the requested delta on
 *   Leave. It is opt-in because the app's other consumers only guard explicit exits and links.
 * - The returned `guard(leave)` routes a non-anchor exit (e.g. a Back button) through the same
 *   `onBlocked`, or runs it immediately while pristine.
 */
export function useUnsavedChangesGuard({
  dirty,
  onBlocked,
  guardHistory = false,
}: UnsavedChangesGuardOptions): (leave: () => void) => void {
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = `${location.pathname}${location.search}${location.hash}`;

  // Latest callback without re-subscribing the document listeners on every render.
  const onBlockedRef = useRef(onBlocked);
  useEffect(() => {
    onBlockedRef.current = onBlocked;
  }, [onBlocked]);
  // True while Leave replays the held click, so the replay is not held again.
  const replayingRef = useRef(false);
  const lastHistoryIndexRef = useRef(browserHistoryIndex());
  const restoreInFlightRef = useRef(false);
  const replayHistoryDeltaRef = useRef<number | null>(null);
  const replayAfterRestoreRef = useRef(false);

  // BrowserRouter writes its new index as it commits a navigation. Remember that index before
  // the next browser popstate arrives, when history.state already points at the destination.
  useLayoutEffect(() => {
    const index = browserHistoryIndex();
    if (index !== null && !restoreInFlightRef.current) lastHistoryIndexRef.current = index;
  });

  useEffect(() => {
    if (!dirty) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      // MDN legacy recipe: preventDefault plus a truthy returnValue for older engines.
      event.preventDefault();
      event.returnValue = true;
    };

    const handleDocumentClick = (event: MouseEvent) => {
      if (replayingRef.current || !isPlainPrimaryClick(event)) return;
      if (!(event.target instanceof Element)) return;
      const anchor = event.target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute('download')) return;
      const target = anchor.getAttribute('target');
      if (target && target.toLowerCase() !== '_self') return;

      let destination: URL;
      try {
        destination = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (destination.origin !== window.location.origin) return;
      const path = `${destination.pathname}${destination.search}${destination.hash}`;
      if (path === currentPath) return;

      event.preventDefault();
      event.stopPropagation();

      onBlockedRef.current(() => {
        if (!anchor.isConnected) {
          navigate(path);
          return;
        }
        // Replay the click so the link's own handler runs (router state, list-return context).
        // A link with no handler leaves the default unprevented — navigate client-side instead of
        // a full document load.
        const fallback = (replay: MouseEvent) => {
          if (replay.defaultPrevented) return;
          replay.preventDefault();
          navigate(path);
        };
        window.addEventListener('click', fallback, { once: true });
        replayingRef.current = true;
        try {
          anchor.click();
        } finally {
          replayingRef.current = false;
          window.removeEventListener('click', fallback);
        }
      });
    };

    const handlePopState = (event: PopStateEvent) => {
      const targetIndex = browserHistoryIndex();
      const lastIndex = lastHistoryIndexRef.current;
      if (targetIndex === null || lastIndex === null) return;

      if (restoreInFlightRef.current) {
        restoreInFlightRef.current = false;
        if (replayAfterRestoreRef.current) {
          replayAfterRestoreRef.current = false;
          const delta = replayHistoryDeltaRef.current;
          if (delta !== null) window.history.go(delta);
        }
        return;
      }

      const delta = targetIndex - lastIndex;
      if (delta === 0) return;
      if (replayHistoryDeltaRef.current === delta) {
        replayHistoryDeltaRef.current = null;
        lastHistoryIndexRef.current = targetIndex;
        return;
      }

      event.stopImmediatePropagation();
      restoreInFlightRef.current = true;
      window.history.go(-delta);
      onBlockedRef.current(() => {
        replayHistoryDeltaRef.current = delta;
        if (restoreInFlightRef.current) replayAfterRestoreRef.current = true;
        else window.history.go(delta);
      });
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('click', handleDocumentClick, true);
    if (guardHistory) window.addEventListener('popstate', handlePopState, true);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('click', handleDocumentClick, true);
      if (guardHistory) window.removeEventListener('popstate', handlePopState, true);
    };
  }, [dirty, currentPath, navigate, guardHistory]);

  return useCallback(
    (leave: () => void) => {
      if (dirty) onBlockedRef.current(leave);
      else leave();
    },
    [dirty],
  );
}
