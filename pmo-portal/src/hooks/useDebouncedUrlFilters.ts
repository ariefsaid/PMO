import { useUrlFilters } from '@/src/components/ui/useUrlFilters';
import { useUrlSearchInput } from './useListWorkingSet';

/** Local input text; queries consume values.q only after the typing pause. */
export function useDebouncedUrlFilters(keys: readonly string[], searchReset: Record<string, string> = {}) {
  const filters = useUrlFilters(keys);
  const [search, setSearch] = useUrlSearchInput(filters.values.q ?? '', (q) => {
    // Match the list-working-set contract: Back leaves the list rather than replaying searches.
    filters.setFilters({ ...searchReset, q }, { replace: true });
  });
  const clear = () => {
    setSearch('');
    filters.clear();
  };
  return { ...filters, search, setSearch, clear };
}
