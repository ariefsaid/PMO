import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
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
  const [params, setParams] = useSearchParams();
  const raw = params.get(key);
  const value = (raw != null && (!allowed || (allowed as readonly string[]).includes(raw)) ? raw : defaultValue) as T;
  const set = useCallback(
    (next: T) => {
      setParams(
        (prev) => {
          const out = new URLSearchParams(prev);
          if (next === defaultValue || next === '') out.delete(key);
          else out.set(key, next);
          return out;
        },
        { replace: true },
      );
    },
    [key, defaultValue, setParams],
  );
  return [value, set];
}

/** A boolean query param: present as `1` when on, omitted when off. */
export function useUrlFlag(key: string): [boolean, (next: boolean) => void] {
  const [value, set] = useUrlParam<string>(key, '0');
  return [value === '1', useCallback((next: boolean) => set(next ? '1' : '0'), [set])];
}

/** A search box whose text lives in one query param (debounced write, Back/links restore it). */
export function useUrlSearchParam(key: string, delayMs?: number): [string, (next: string) => void] {
  const [urlValue, setUrlValue] = useUrlParam<string>(key, '');
  return useUrlSearchInput(urlValue, setUrlValue, delayMs);
}
