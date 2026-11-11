import { useSearchParams } from 'react-router';

/** URL-backed filter values; empty values are omitted and unrelated query parameters survive. */
export function useUrlFilters(keys: readonly string[]) {
  const [params, setParams] = useSearchParams();
  const values = Object.fromEntries(keys.map((key) => [key, params.get(key) ?? '']));
  // react-router 8: setSearchParams calls in the same tick do NOT queue — each event must be
  // ONE setParams call. setFilters batches multi-key writes; setFilter is the single-key form.
  const apply = (partial: Record<string, string>, options?: { replace?: boolean }) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(partial)) {
        if (!keys.includes(key)) continue;
        if (value) next.set(key, value); else next.delete(key);
      }
      return next;
    }, options);
  };
  const setFilter = (key: string, value: string, options?: { replace?: boolean }) => {
    if (!keys.includes(key)) return;
    apply({ [key]: value }, options);
  };
  const setFilters = (partial: Record<string, string>, options?: { replace?: boolean }) => apply(partial, options);
  const clear = () => setParams((current) => {
    const next = new URLSearchParams(current);
    keys.forEach((key) => next.delete(key));
    return next;
  });
  return { values, setFilter, setFilters, clear };
}
