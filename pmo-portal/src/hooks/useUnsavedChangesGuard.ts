import { useCallback, useEffect, useRef } from 'react';
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
}

const isPlainPrimaryClick = (event: MouseEvent): boolean =>
  !event.defaultPrevented &&
  event.button === 0 &&
  !event.metaKey &&
  !event.ctrlKey &&
  !event.shiftKey &&
  !event.altKey;

/**
 * FR-MTG-040 / DD-MTG-11 — hold in-app exits while `dirty`.
 *
 * - Same-origin, same-tab `<a href>` activations are intercepted (capture phase, before React's
 *   root listener). Modified clicks, `target` other than `_self`, `download` and cross-origin
 *   links are left to the browser — they do not discard this tab's edits.
 * - `beforeunload` is cancelled so reload / tab close / external URL get the browser's prompt.
 * - The returned `guard(leave)` routes a non-anchor exit (e.g. a Back button) through the same
 *   `onBlocked`, or runs it immediately while pristine.
 */
export function useUnsavedChangesGuard({
  dirty,
  onBlocked,
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

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('click', handleDocumentClick, true);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('click', handleDocumentClick, true);
    };
  }, [dirty, currentPath, navigate]);

  return useCallback(
    (leave: () => void) => {
      if (dirty) onBlockedRef.current(leave);
      else leave();
    },
    [dirty],
  );
}
