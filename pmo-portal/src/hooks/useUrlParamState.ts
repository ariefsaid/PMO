import { useUrlFilters } from '@/src/components/ui/useUrlFilters';
import { useUrlSearchInput } from '@/src/hooks/useListWorkingSet';

/**
 * One string query param as state: read from the URL, written back with `replace` so filtering
 * does not stack history entries. The default is omitted from the URL, so a link carries only
 * what differs from the page's starting state. A value outside `allowed` reads as the default.
 */
export function useUrlParam<T extends string>(
  key: string,
  defaultValue: T,
  allowed?: readonly T[],
): [T, (next: T) => void] {
  const { values, setFilter } = useUrlFilters([key]);
  const raw = values[key];
  const value = (raw !== '' && (!allowed || (allowed as readonly string[]).includes(raw)) ? raw : defaultValue) as T;
  const set = (next: T) => setFilter(key, next === defaultValue ? '' : next, { replace: true });
  return [value, set];
}

/** A boolean query param: present as `1` when on, omitted when off. */
export function useUrlFlag(key: string): [boolean, (next: boolean) => void] {
  const [value, set] = useUrlParam<string>(key, '0');
  return [value === '1', (next: boolean) => set(next ? '1' : '0')];
}

/** A search box whose text lives in one query param (debounced write, Back/links restore it). */
export function useUrlSearchParam(key: string, delayMs?: number): [string, (next: string) => void] {
  const [urlValue, setUrlValue] = useUrlParam<string>(key, '');
  return useUrlSearchInput(urlValue, setUrlValue, delayMs);
}
