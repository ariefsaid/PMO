import { useEffect } from 'react';

/** The `page` address parameter as a 1-based page number; anything missing or invalid is page 1. */
export function parsePageParam(raw: string): number {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/**
 * A pasted or stale address can name a page past the end (rows were archived since). Once the true total is known
 * the address is corrected in place (replace, so Back does not return to the empty page).
 */
export function useClampPage(page: number, total: number | undefined, pageSize: number, setPage: (page: number, options: { replace: boolean }) => void) {
  const last = total === undefined ? undefined : Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => {
    if (last !== undefined && page > last) setPage(last, { replace: true });
  }, [page, last, setPage]);
}
