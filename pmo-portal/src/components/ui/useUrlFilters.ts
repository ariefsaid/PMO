import { useSearchParams } from 'react-router';

/** URL-backed filter values; empty values are omitted and unrelated query parameters survive. */
export function useUrlFilters(keys: readonly string[]) {
  const [params, setParams] = useSearchParams();
  const values = Object.fromEntries(keys.map((key) => [key, params.get(key) ?? '']));
  const setFilter = (key: string, value: string) => {
    if (!keys.includes(key)) return;
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value); else next.delete(key);
      return next;
    });
  };
  const clear = () => setParams((current) => {
    const next = new URLSearchParams(current);
    keys.forEach((key) => next.delete(key));
    return next;
  });
  return { values, setFilter, clear };
}

