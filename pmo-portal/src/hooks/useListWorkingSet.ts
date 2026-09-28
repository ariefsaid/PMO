import { useCallback, useEffect, useMemo } from 'react';
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
  ready?: boolean;
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
 * Its only unprompted write: once `ready`, when the URL has no explicit `view` and the session
 * view is nondefault, it adds that view with one replace (keeping router state, so a pending
 * scroll restore survives) so a copied link agrees with what is visible. It never canonicalizes
 * any other key — an explicit drill filter stays exactly as written.
 */
export function useListWorkingSet<K extends ListName>(
  list: K,
  options: UseListWorkingSetOptions = {},
): {
  workingSet: ListWorkingSetByName[K];
  /**
   * Replace the list URL with `updater(current)`. Call it ONCE per user event: `current` is the
   * working set of the last rendered URL, not of a replace still in flight, so a second call in
   * the same handler would build from the same snapshot and drop the first call's change.
   */
  setWorkingSet: (updater: ListWorkingSetUpdater<K>) => void;
} {
  const location = useLocation();
  const navigate = useNavigate();

  const { sessionView, projectsDefaultFilter, ready = true } = options;

  const workingSet = useMemo(
    () => parseListWorkingSet(list, location.search, { sessionView, projectsDefaultFilter }),
    [list, location.search, sessionView, projectsDefaultFilter],
  );

  const targetSearch = ready
    ? materializeSessionView(list, location.search, sessionView)
    : location.search;
  useEffect(() => {
    // Equality guard: once the URL already carries the materialized view (or needs nothing), this
    // is a no-op, so the replace happens at most once and never loops.
    if (location.search === targetSearch) return;
    navigate(`${location.pathname}${targetSearch}`, { replace: true, state: location.state });
  }, [location.pathname, location.search, location.state, targetSearch, navigate]);

  const setWorkingSet = useCallback(
    (updater: ListWorkingSetUpdater<K>) => {
      const next = updater(workingSet);
      const params = serializeListWorkingSet(list, location.search, next, {
        projectsDefaultFilter,
        sessionView,
      });
      const search = params.toString();
      navigate(`${location.pathname}${search ? `?${search}` : ''}`, { replace: true });
    },
    [
      list,
      location.pathname,
      location.search,
      navigate,
      projectsDefaultFilter,
      sessionView,
      workingSet,
    ],
  );

  return { workingSet, setWorkingSet };
}
