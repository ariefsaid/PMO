import { useCallback, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  canCaptureFromList,
  createListReturnContext,
  isCanonicalRecordPath,
  listIndexPath,
  listReturnNavigation,
  safeLocalPath,
  withListReturnContext,
  LIST_SCROLL_RESTORE_STATE_KEY,
} from '@/src/lib/listReturnContext';
import type { ListName } from '@/src/lib/listWorkingSet';

export const LIST_ENTRY_SCROLL_STATE_KEY = 'pmoListEntryScroll';
const LIST_SCROLL_CONSUMED_STATE_KEY = 'pmoListScrollConsumedFor';

export interface UseListReturnOptions {
  /** List page currently mounted; also the default record owner for an open action. */
  list: ListName;
  /** Whether list content has settled and rendered, including an empty state. */
  ready?: boolean;
}

export interface UseListReturnResult {
  /** Capture the active list entry and navigate to a canonical record route. */
  openRecord: (recordPath: string, owner?: ListName) => boolean;
  /** Navigate to validated list context or the record owner's index (pushes a new entry). */
  returnToList: (owner?: ListName) => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scrollElement(): HTMLElement | null {
  return typeof document === 'undefined'
    ? null
    : document.querySelector<HTMLElement>('.main-scroll');
}

/**
 * Accept only a canonical `/module/:id` target (optionally carrying a query). Tab / deep paths such
 * as `/procurement/:id/approvals` are intentionally rejected — opening a record always lands on its
 * canonical detail route, whose owning-list context this seam can faithfully restore.
 */
function safeRecordTarget(owner: ListName, target: string): string | undefined {
  const safe = safeLocalPath(target);
  if (!safe) return undefined;
  const url = new URL(safe, window.location.origin);
  if (!isCanonicalRecordPath(url.pathname, owner)) return undefined;
  return `${url.pathname}${url.search}`;
}

function saveEntryScroll(locationKey: string, path: string, scrollTop: number): void {
  const current = isRecord(window.history.state) ? window.history.state : {};
  const next: Record<string, unknown> = {
    ...current,
    [LIST_ENTRY_SCROLL_STATE_KEY]: { locationKey, path, scrollTop },
  };
  delete next[LIST_SCROLL_CONSUMED_STATE_KEY];
  window.history.replaceState(next, '');
}

function storedEntryScroll(
  state: unknown,
  list: ListName,
  locationKey: string,
  path: string,
): number | undefined {
  if (!isRecord(state) || !isRecord(state[LIST_ENTRY_SCROLL_STATE_KEY])) return undefined;
  const entry = state[LIST_ENTRY_SCROLL_STATE_KEY];
  const context = createListReturnContext(list, path, entry.scrollTop as number | undefined);
  if (
    entry.locationKey !== locationKey ||
    entry.path !== path ||
    !context ||
    context.scrollTop === undefined
  ) {
    return undefined;
  }
  return context.scrollTop;
}

function explicitScrollRestore(state: unknown, list: ListName, path: string): number | undefined {
  if (!isRecord(state) || !isRecord(state[LIST_SCROLL_RESTORE_STATE_KEY])) return undefined;
  const restore = state[LIST_SCROLL_RESTORE_STATE_KEY];
  if (restore.list !== list || typeof restore.path !== 'string') return undefined;
  const context = createListReturnContext(
    list,
    restore.path,
    restore.scrollTop as number | undefined,
  );
  if (!context || context.path !== path || context.scrollTop === undefined) return undefined;
  return context.scrollTop;
}

function markScrollConsumed(locationKey: string): void {
  const current = isRecord(window.history.state) ? window.history.state : {};
  const next: Record<string, unknown> = {
    ...current,
    [LIST_SCROLL_CONSUMED_STATE_KEY]: locationKey,
  };
  delete next[LIST_ENTRY_SCROLL_STATE_KEY];
  window.history.replaceState(next, '');
}

/**
 * The router adapter the desktop parent breadcrumb calls: push `path` carrying `state` (the clean
 * return entry from `contextualListReturnNavigation`), exactly as the mobile BackBar's
 * `returnToList` does. A crumb without a return descriptor calls it with the path alone.
 */
export function useReturnNavigate(): (path: string, state?: unknown) => void {
  const navigate = useNavigate();
  return useCallback((path: string, state?: unknown) => navigate(path, { state }), [navigate]);
}

/**
 * Captures list context when opening a record and restores it once after a return list is ready.
 * Native Back uses state on the source browser-history entry; explicit return pushes a clean entry
 * carrying the optional one-shot scroll restore.
 */
export function useListReturn({ list, ready = false }: UseListReturnOptions): UseListReturnResult {
  const location = useLocation();
  const navigate = useNavigate();
  const path = `${location.pathname}${location.search}`;

  const openRecord = useCallback(
    (recordPath: string, owner: ListName = list): boolean => {
      if (!canCaptureFromList(list, owner)) return false;
      const destination = safeRecordTarget(owner, recordPath);
      if (!destination) {
        if (import.meta.env.DEV) {
          console.warn(
            `[list-return] openRecord rejected target "${recordPath}" for owner "${owner}": ` +
              'only canonical /module/:id paths are accepted (not tab/deep paths).',
          );
        }
        return false;
      }

      const main = scrollElement();
      const offset =
        main && Number.isFinite(main.scrollTop) && main.scrollTop >= 0 ? main.scrollTop : undefined;
      const context = createListReturnContext(list, path, offset, location.key);
      if (!context) return false;
      if (offset !== undefined) saveEntryScroll(location.key, path, offset);
      navigate(destination, { state: withListReturnContext(location.state, context) });
      return true;
    },
    [list, location.key, location.state, navigate, path],
  );

  const returnToList = useCallback(
    (owner: ListName = list): string => {
      const { path: destination, state } = listReturnNavigation(location.state, owner);
      // Push (the web norm) rather than replace, so a following browser Back reaches the detail
      // entry instead of appearing to do nothing; the clean state restores the list position.
      navigate(destination, { state });
      return destination;
    },
    [list, location.state, navigate],
  );

  useEffect(() => {
    if (!ready || location.pathname !== listIndexPath(list)) return;
    const historyState = window.history.state;
    if (isRecord(historyState) && historyState[LIST_SCROLL_CONSUMED_STATE_KEY] === location.key) {
      return;
    }

    const currentPath = `${location.pathname}${location.search}`;
    const scrollTop =
      explicitScrollRestore(location.state, list, currentPath) ??
      storedEntryScroll(historyState, list, location.key, currentPath);
    if (scrollTop === undefined) return;

    // Defer past AppShell's pathname reset and the ready list's commit. Rows now own the actual
    // scroll range, so clamp an old offset to the rendered content instead of restoring past it.
    const timer = window.setTimeout(() => {
      const main = scrollElement();
      if (!main) return;
      const maximum = Math.max(0, main.scrollHeight - main.clientHeight);
      const restoredTop = Math.min(scrollTop, maximum);
      main.scrollTop = restoredTop;
      try {
        main.scrollTo?.({ top: restoredTop });
      } catch {
        // Some embedded webviews expose scrollTo but reject it; scrollTop remains the fallback.
      }
      markScrollConsumed(location.key);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [list, location.key, location.pathname, location.search, location.state, ready]);

  return { openRecord, returnToList };
}