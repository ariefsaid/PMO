import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  UNSAFE_DataRouterContext,
  UNSAFE_DataRouterStateContext,
  useLocation,
  useNavigate,
  type Blocker,
  type BlockerFunction,
} from 'react-router';

export interface UnsavedChangesGuardOptions {
  /** True while the page holds edits that would be lost by leaving. */
  dirty: boolean;
  /**
   * Called when an exit is held. `leave` performs the exit exactly as the user asked for it (the
   * link's own click handler with its router state, or a plain local navigation) — call it from
   * the confirm dialog's Leave; drop it on Stay.
   */
  onBlocked: (leave: () => void) => void;
  /**
   * Also hold browser Back/Forward changes. Off by default because a bare harness/router without
   * browser history has nothing to hold; every guarded form in the app turns it on.
   */
  guardHistory?: boolean;
}

// ── Data-router blocker (the application router, App.tsx) ────────────────────
let nextBlockerId = 0;

/**
 * Router-level history blocking, the only supported way to hold a Back/Forward (POP) change: when
 * a POP navigation is blocked the data router itself reverts the history entry, keeps the page
 * mounted, and replays the exact change on `proceed()`. This is react-router's `useBlocker`,
 * re-implemented locally only so it can be absent: outside a data router (plain `BrowserRouter` /
 * `MemoryRouter` harnesses and embedded routers) it returns `hasRouter: false` and the guard falls
 * back to its own `popstate` listener, instead of `useBlocker` throwing.
 */
function useOptionalBlocker(shouldBlock: BlockerFunction): {
  hasRouter: boolean;
  blocker: Blocker | null;
} {
  const dataRouterContext = useContext(UNSAFE_DataRouterContext);
  const routerState = useContext(UNSAFE_DataRouterStateContext);
  const router = dataRouterContext?.router ?? null;
  const [blockerKey, setBlockerKey] = useState('');

  // Latest predicate without re-registering the blocker on every render.
  const shouldBlockRef = useRef(shouldBlock);
  useLayoutEffect(() => {
    shouldBlockRef.current = shouldBlock;
  });
  const blockerFunction = useCallback<BlockerFunction>(
    (args) => shouldBlockRef.current(args),
    [],
  );

  useEffect(() => {
    if (!router) return;
    const key = String(++nextBlockerId);
    setBlockerKey(key);
    return () => router.deleteBlocker(key);
  }, [router]);

  useEffect(() => {
    if (router && blockerKey !== '') router.getBlocker(blockerKey, blockerFunction);
  }, [router, blockerKey, blockerFunction]);

  const blocker = router && routerState && blockerKey !== ''
    ? routerState.blockers.get(blockerKey) ?? null
    : null;
  return { hasRouter: router !== null, blocker };
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
 * - `guardHistory` holds browser Back/Forward: on the application's data router
 *   (App.tsx) through a router blocker, which reverts the history entry and replays it on Leave;
 *   under a plain `BrowserRouter` (test harnesses, embedded routers) through a `popstate`
 *   listener that requests the same delta on Leave.
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
  // Latest dirty flag for the router blocker, whose predicate is registered once.
  const dirtyRef = useRef(dirty);
  useLayoutEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const { hasRouter, blocker: historyBlocker } = useOptionalBlocker(
    useCallback<BlockerFunction>(
      ({ historyAction }) => guardHistory && historyAction === 'POP' && dirtyRef.current,
      [guardHistory],
    ),
  );

  // The router reverted the entry and is waiting on us: report the same confirm an exit gets.
  // `blocker.proceed()` replays exactly the Back/Forward the user asked for; dropping `leave`
  // (Stay) leaves the page and its edits where they are.
  useEffect(() => {
    if (!historyBlocker || historyBlocker.state !== 'blocked') return;
    onBlockedRef.current(() => historyBlocker.proceed?.());
  }, [historyBlocker]);

  // A saved draft is no longer at risk: release a block the page dismissed with Stay so the
  // router does not keep a stale proceeding state.
  useEffect(() => {
    if (!dirty && historyBlocker?.state === 'blocked') historyBlocker.reset?.();
  }, [dirty, historyBlocker]);

  // True while Leave replays the held click, so the replay is not held again.
  const replayingRef = useRef(false);
  const lastHistoryIndexRef = useRef(browserHistoryIndex());
  const restoreInFlightRef = useRef(false);
  const replayHistoryDeltaRef = useRef<number | null>(null);
  const replayAfterRestoreRef = useRef(false);

  // The router writes its new history index as it commits a navigation. Remember that index
  // before the next browser popstate arrives, when history.state already points at the destination.
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
    // A data router owns POP blocking itself (the blocker above). This listener is the fallback
    // for routers without one — it must not also swallow the popstate the router needs to see.
    const usePopStateFallback = guardHistory && !hasRouter;
    if (usePopStateFallback) window.addEventListener('popstate', handlePopState, true);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('click', handleDocumentClick, true);
      if (usePopStateFallback) window.removeEventListener('popstate', handlePopState, true);
    };
  }, [dirty, currentPath, navigate, guardHistory, hasRouter]);

  return useCallback(
    (leave: () => void) => {
      if (dirty) onBlockedRef.current(leave);
      else leave();
    },
    [dirty],
  );
}
