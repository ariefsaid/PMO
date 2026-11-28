/** Minimal TanStack Query-compatible contract for a list or detail read. */
export interface ReadQueryLike<T> {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  refetch: () => unknown;
}

export interface ResolveReadStateOptions<T> {
  /** Override how a loaded value is classified as empty (default: empty array or null). */
  isEmpty?: (data: T) => boolean;
}

export type ReadStatePhase<T> =
  | { status: 'loading' }
  | { status: 'error'; onRetry: () => void }
  | { status: 'empty'; data: T }
  | { status: 'ready'; data: T; refreshError: { onRetry: () => void } | null };

function defaultIsEmpty(data: unknown): boolean {
  if (data === null) return true;
  if (Array.isArray(data)) return data.length === 0;
  return false;
}

/**
 * The single read-state rule for list and detail reads (#2976):
 * - Pending (or absent data) renders loading — never empty.
 * - A failed read renders retry and keeps any previously loaded non-empty data visible.
 * - Only a successful empty read renders empty copy.
 */
export function resolveReadState<T>(
  query: ReadQueryLike<T>,
  options?: ResolveReadStateOptions<T>,
): ReadStatePhase<T> {
  const isEmpty = options?.isEmpty ?? defaultIsEmpty;
  const onRetry = () => { void query.refetch(); };

  if (query.data === undefined) {
    if (query.isError) return { status: 'error', onRetry };
    return { status: 'loading' };
  }

  const empty = isEmpty(query.data);
  if (query.isError) {
    if (empty) return { status: 'error', onRetry };
    return { status: 'ready', data: query.data, refreshError: { onRetry } };
  }

  if (empty) return { status: 'empty', data: query.data };
  return { status: 'ready', data: query.data, refreshError: null };
}
