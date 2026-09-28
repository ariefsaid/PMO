import { useCallback, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  resolveListWorkingSet,
  serializeListWorkingSet,
  type ListName,
  type ListWorkingSetByName,
  type ListWorkingSetOptions,
} from '@/src/lib/listWorkingSet';

export interface UseListWorkingSetOptions {
  /**
   * Effective persisted view, consulted only when a URL view is absent or invalid. The adopting
   * pages pass `readProjectView()` / `readPipelineView()` / `readProcurementView()` here.
   */
  sessionView?: unknown;
  /** Projects' role-appropriate default filter (Engineer keeps My Projects). */
  projectsDefaultFilter?: ListWorkingSetOptions['projectsDefaultFilter'];
}

export type ListWorkingSetUpdater<K extends ListName> = (
  current: ListWorkingSetByName[K],
) => ListWorkingSetByName[K];

/**
 * The thin React Router adapter over the list working-set codec that adopting pages need. It
 * returns the effective parsed working set and a typed setter that writes only this list's owned
 * query keys with history **replacement** (no browser-history entry per keystroke), preserving
 * every unrelated key. On mount it materializes a nondefault session-stored view into the URL once
 * (also a replace) so a copied link agrees with what is visible.
 */
export function useListWorkingSet<K extends ListName>(
  list: K,
  options: UseListWorkingSetOptions = {},
): {
  workingSet: ListWorkingSetByName[K];
  setWorkingSet: (updater: ListWorkingSetUpdater<K>) => void;
} {
  const location = useLocation();
  const navigate = useNavigate();

  const sessionView = options.sessionView;
  const projectsDefaultFilter = options.projectsDefaultFilter;

  const resolved = useMemo(
    () => resolveListWorkingSet(list, location.search, { sessionView, projectsDefaultFilter }),
    [list, location.search, sessionView, projectsDefaultFilter],
  );

  // Materialize the canonical serialization (a nondefault session view, or the dropped token from
  // an invalid enum) into the URL exactly once via replace. The canonical comparison guards this:
  // once the URL matches, the effect is a no-op, so this never turns into a replace loop.
  const canonicalSearch = resolved.search.toString();
  const expectedSearch = canonicalSearch ? `?${canonicalSearch}` : '';
  useEffect(() => {
    if (location.search === expectedSearch) return;
    navigate(`${location.pathname}${expectedSearch}`, { replace: true });
  }, [location.pathname, location.search, expectedSearch, navigate]);

  const workingSet = resolved.value;

  const setWorkingSet = useCallback(
    (updater: ListWorkingSetUpdater<K>) => {
      const next = updater(workingSet);
      const params = serializeListWorkingSet(list, location.search, next, {
        projectsDefaultFilter,
      });
      const search = params.toString();
      navigate(`${location.pathname}${search ? `?${search}` : ''}`, { replace: true });
    },
    [list, location.pathname, location.search, navigate, projectsDefaultFilter, workingSet],
  );

  return { workingSet, setWorkingSet };
}