import { useEffect, useRef } from 'react';

/** How long a money panel waits before re-asking a refused read once (#2896). */
export const RESTRICTED_RE_ASK_MS = 1_000;

export interface RestrictedRead {
  restricted: boolean;
  isFetching?: boolean;
  refetch: () => unknown;
}

/**
 * #2896: a refused money read comes back as the VALUE `'restricted'` (a 42501 never becomes an error),
 * so react-query caches it as a success and nothing re-asks — one transient refusal pinned the panel
 * closed until a reload. Re-asks each restricted read once per `scopeKey` (e.g. `projectId`), a beat
 * later; a viewer genuinely refused stays restricted after that one re-ask, so recovery never loops.
 *
 * The one-shot flag flips only when the timer actually fires (never before), and the effect depends
 * only on primitive flags — so a sibling query resolving or React StrictMode cleanup during the wait
 * cannot cancel the timer and strand the panel.
 */
export function useReAskRestricted(scopeKey: string, reads: readonly RestrictedRead[]): void {
  const reAskedScope = useRef<string | null>(null);
  const readsRef = useRef(reads);
  readsRef.current = reads;

  const anyRestricted = reads.some((r) => r.restricted);
  const anyFetching = reads.some((r) => Boolean(r.isFetching));

  useEffect(() => {
    if (!anyRestricted || anyFetching || reAskedScope.current === scopeKey) return;
    const timer = setTimeout(() => {
      reAskedScope.current = scopeKey;
      for (const r of readsRef.current) {
        if (r.restricted && !r.isFetching) void r.refetch();
      }
    }, RESTRICTED_RE_ASK_MS);
    return () => clearTimeout(timer);
  }, [scopeKey, anyRestricted, anyFetching]);
}
