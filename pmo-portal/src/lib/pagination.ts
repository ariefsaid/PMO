/**
 * Shared list-DAL pagination helper (data-layer performance hardening #4).
 *
 * The highest-volume list reads (procurement, projects, companies, contacts, notifications,
 * timesheets) are OPT-IN paginated via a `page`/`pageSize` param the hooks CAN pass. Pagination
 * only activates when a caller explicitly supplies `page` and/or `pageSize` — an omitted
 * `params` (or a `params` object with neither field) applies NO `.range()` at all, preserving
 * every existing caller's unbounded-list behavior exactly (e.g. the ⌘K CommandPalette record
 * search, which indexes the full cached list client-side; capping it silently by default would
 * make search silently miss records past the first page).
 */

/** A sensible default page size once a caller opts into `page`/`pageSize`. */
export const DEFAULT_PAGE_SIZE = 50;

/** Optional pagination params a list DAL function accepts. `page` is 0-indexed. */
export interface PageParams {
  page?: number;
  pageSize?: number;
}

/** The inclusive [from, to] row-index range PostgREST's `.range()` expects. */
export interface RowRange {
  from: number;
  to: number;
}

/**
 * Resolves `{ page, pageSize }` into the inclusive `[from, to]` row range for PostgREST
 * `.range(from, to)` — or `undefined` when the caller didn't opt in (no `params`, or a
 * `params` object with neither `page` nor `pageSize` set), so the DAL function issues its
 * original unbounded query. Once opted in, an omitted `page` defaults to 0 (clamped
 * non-negative) and an omitted `pageSize` defaults to `DEFAULT_PAGE_SIZE`.
 */
export function resolveRange(params?: PageParams): RowRange | undefined {
  if (params?.page === undefined && params?.pageSize === undefined) return undefined;
  const pageSize = params?.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = Math.max(0, params?.page ?? 0);
  const from = page * pageSize;
  const to = from + pageSize - 1;
  return { from, to };
}
