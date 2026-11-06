import { useCallback, useRef } from 'react';

/**
 * Perf (dashboard render work): the dashboard pages re-render once per query settle (16+ queries,
 * ~5-10 settles per load). Two hand-rails let a memoised panel bail out of those parent commits
 * without ever showing stale content:
 *
 *  - `useStableCallback` gives an event handler a REFERENCE that never changes while always calling
 *    the latest closure (the `useEvent` pattern). The dashboard hooks hand back fresh `retry`
 *    functions on every render, so a memoised panel would otherwise re-render on every commit.
 *  - `useStableValue` keeps the previous value's reference while its signature is unchanged. The
 *    needs-you hook rebuilds its arrays on every render (its own file is another branch's), so a
 *    panel that took `areaItems` directly could never bail out; matching on the values the panel
 *    actually renders keeps the reference stable and still updates the moment one changes.
 */

/** A callback with a permanent identity that always runs the latest `fn`. */
export function useStableCallback<T extends (...args: never[]) => unknown>(fn: T): T {
  const latest = useRef(fn);
  latest.current = fn;
  // Identity is deliberately permanent; the ref carries the latest closure.
  return useCallback(((...args: never[]) => latest.current(...args)) as T, []);
}

/** The previous `value` until `signature(value)` changes, so callers can compare by reference. */
export function useStableValue<T>(value: T, signature: (value: T) => string): T {
  const rendered = useRef(value);
  const renderedSignature = useRef<string | undefined>(undefined);
  const nextSignature = signature(value);
  if (renderedSignature.current !== nextSignature) {
    rendered.current = value;
    renderedSignature.current = nextSignature;
  }
  return rendered.current;
}

/** Signature of an attention/approval list: everything either list renders. */
export const itemsSignature = (items: ReadonlyArray<{ id: string; count: unknown; label: string; sub?: string; amount?: unknown; href: string; tooltip?: string }>): string =>
  items.map((item) => [item.id, String(item.count), item.label, item.sub ?? '', String(item.amount ?? ''), item.href, item.tooltip ?? ''].join('\u001f')).join('\u001e');

/** Signature of a per-project count map (`useNeedsYou().pmOverdueTasksByProject`). */
export const countsSignature = (counts: Record<string, number>): string =>
  Object.entries(counts).map(([id, count]) => `${id}=${count}`).join(';');
