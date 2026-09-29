import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  materializeSessionView,
  parseListWorkingSet,
  serializeListWorkingSet,
  type ListName,
  type ListWorkingSetByName,
  type ListWorkingSetOptions,
} from '@/src/lib/listWorkingSet';

export interface UseListWorkingSetOptions {
  /**
   * Effective persisted view, consulted only when the URL has no `view`. The adopting pages pass
   * `readProjectView()` / `readPipelineView()` / `readProcurementView()` here.
   */
  sessionView?: unknown;
  /** Projects' role-appropriate default filter (Engineer keeps My Projects). */
  projectsDefaultFilter?: ListWorkingSetOptions['projectsDefaultFilter'];
  /**
   * Whether role-scoped defaults (`projectsDefaultFilter`) and `sessionView` are known yet. Until
   * true the hook writes nothing on its own, so no URL is rewritten against a default that has not
   * arrived. Defaults to true.
   */
  defaultsReady?: boolean;
}

export type ListWorkingSetUpdater<K extends ListName> = (
  current: ListWorkingSetByName[K],
) => ListWorkingSetByName[K];

/**
 * The thin React Router adapter over the list working-set codec that adopting pages need. It
 * returns the effective parsed working set and a typed setter that writes only this list's owned
 * query keys with history **replacement** (no browser-history entry per keystroke), preserving
 * every unrelated key.
 *
 * Search contract: React Router applies location updates inside `startTransition`, so the parsed
 * `q` lags the keystroke that produced it. Never bind a text input's `value` to `workingSet.q`;
 * keep the text in local state and write it to the URL with `useUrlSearchInput`. Only discrete
 * controls (enum filters, referenced-ID selects, and views) bind directly to the working set.
 *
 * Its only unprompted write: once `defaultsReady`, when the URL has no explicit `view` and the
 * session view is nondefault, it adds that view with one replace so a copied link agrees with what
 * is visible. That replace carries the existing router state forward unchanged. It never
 * canonicalizes any other key — an explicit drill filter stays exactly as written.
 */
export function useListWorkingSet<K extends ListName>(
  list: K,
  options: UseListWorkingSetOptions = {},
): {
  workingSet: ListWorkingSetByName[K];
  /**
   * Replace the list URL with `updater(current)`. `current` is the working set of the latest write
   * this hook made (even one the router has not committed yet), or of the committed URL after any
   * outside navigation, so consecutive writes compose instead of dropping each other.
   */
  setWorkingSet: (updater: ListWorkingSetUpdater<K>) => void;
} {
  const location = useLocation();
  const navigate = useNavigate();

  const { sessionView, projectsDefaultFilter, defaultsReady = true } = options;

  const workingSet = useMemo(
    () => parseListWorkingSet(list, location.search, { sessionView, projectsDefaultFilter }),
    [list, location.search, sessionView, projectsDefaultFilter],
  );

  const targetSearch = defaultsReady
    ? materializeSessionView(list, location.search, sessionView)
    : location.search;
  useEffect(() => {
    // Equality guard: once the URL already carries the materialized view (or needs nothing), this
    // is a no-op, so the replace happens at most once and never loops.
    if (location.search === targetSearch) return;
    navigate(`${location.pathname}${targetSearch}`, { replace: true, state: location.state });
  }, [location.pathname, location.search, location.state, targetSearch, navigate]);

  // The router commits a location change as a transition, and typing can keep pre-empting it. Build
  // each write on the latest one this hook made, not the last committed render, or a filter picked
  // just before a debounced search write is silently dropped. `pending` holds this hook's writes in
  // order: a commit of one of them retires it and anything older, but never rolls the base back
  // while a newer write is still in flight; any other commit is an outside navigation and wins.
  const latestSearch = useRef(location.search);
  const pending = useRef<string[]>([]);
  useLayoutEffect(() => {
    const own = pending.current.indexOf(location.search);
    if (own >= 0) {
      pending.current = pending.current.slice(own + 1);
      if (pending.current.length > 0) return;
    } else {
      pending.current = [];
    }
    latestSearch.current = location.search;
  }, [location.key, location.search]);

  const setWorkingSet = useCallback(
    (updater: ListWorkingSetUpdater<K>) => {
      const base = latestSearch.current;
      const current = parseListWorkingSet(list, base, { sessionView, projectsDefaultFilter });
      const params = serializeListWorkingSet(list, base, updater(current), {
        projectsDefaultFilter,
        sessionView,
      });
      const search = params.toString();
      latestSearch.current = search ? `?${search}` : '';
      pending.current.push(latestSearch.current);
      navigate(`${location.pathname}${latestSearch.current}`, { replace: true });
    },
    [list, location.pathname, navigate, projectsDefaultFilter, sessionView],
  );

  return { workingSet, setWorkingSet };
}

/**
 * A list search box over the URL working set (see the search contract on `useListWorkingSet`).
 * Returns the input's text and its change handler. Typed text is local at once and written with
 * `commit` (usually `q => setWorkingSet(ws => ({ ...ws, q }))`) after `delayMs` without typing. A
 * URL change this hook did not write (Back, a drill link, Clear all) replaces the text and cancels
 * a pending write. A Clear-all that leaves `q` unchanged should also call the returned setter with ''.
 */
export function useUrlSearchInput(
  urlValue: string,
  commit: (next: string) => void,
  delayMs = 250,
): [string, (next: string) => void] {
  const [text, setText] = useState(urlValue);
  const written = useRef(urlValue);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latestCommit = useRef(commit);
  useEffect(() => {
    latestCommit.current = commit;
  });
  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (urlValue === written.current) return; // the echo of our own write
    written.current = urlValue;
    clearTimeout(timer.current);
    setText(urlValue);
  }, [urlValue]);

  const onChange = useCallback(
    (next: string) => {
      setText(next);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        written.current = next;
        latestCommit.current(next);
      }, delayMs);
    },
    [delayMs],
  );
  return [text, onChange];
}
