import { useCallback } from 'react';
import { parseListWorkingSet, type ListWorkingSetByName } from '@/src/lib/listWorkingSet';
import { useListWorkingSet, useUrlSearchInput } from '@/src/hooks/useListWorkingSet';

/** The lists whose working set is one referenced/enum filter plus a search box, with no view. */
export type SearchListName = 'companies' | 'contacts' | 'meetings';

/**
 * The one wiring of the URL working set for Companies, Contacts and Meetings, so the three pages
 * cannot drift: URL-owned filter + search (`useListWorkingSet`), the search box's local text
 * (`useUrlSearchInput`), and a Clear filters action that returns every owned key to its default
 * while preserving unrelated query keys.
 *
 * Record open + scroll restore stay a separate `useListReturn({ list, contentReady })` call on the
 * page, because `contentReady` depends on the page's query — and Meetings' query depends on the
 * search text this hook returns. Always pass `contentReady`: its default (false) never restores.
 */
export function useListSearchWorkingSet<K extends SearchListName>(list: K) {
  const { workingSet, setWorkingSet } = useListWorkingSet(list);
  const [search, setSearch] = useUrlSearchInput(workingSet.q, (q) =>
    setWorkingSet((ws) => ({ ...ws, q })),
  );

  const clearFilters = useCallback(() => {
    setSearch('');
    setWorkingSet((): ListWorkingSetByName[K] => parseListWorkingSet(list, ''));
  }, [list, setSearch, setWorkingSet]);

  return { workingSet, setWorkingSet, search, setSearch, clearFilters };
}
