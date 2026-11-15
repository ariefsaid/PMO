/**
 * erpnext/readBatching.ts (#2120): helpers that cut the reads a background ERP pass repeats per row — run per-row reads
 * a few at a time (`mapInOrderBounded`), and read per-pass facts once (`onceRead`, `memoiseRead`). Pure and
 * Deno-importable (no imports).
 */

/**
 * Map `items` through `fn` with at most `limit` calls in flight, returning the results in INPUT order.
 *
 * Failure behaves like the serial `for … await` loop it replaces: once any call fails no further call starts, the
 * calls already running are allowed to finish, and the promise rejects with the error of the EARLIEST failing item —
 * the error the serial loop would have thrown. (Items start in input order, so every earlier item has started.)
 */
export async function mapInOrderBounded<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failedAt = -1;
  let failure: unknown;
  const worker = async (): Promise<void> => {
    while (next < items.length && failedAt < 0) {
      const index = next++;
      try {
        results[index] = await fn(items[index], index);
      } catch (err) {
        if (failedAt < 0 || index < failedAt) {
          failedAt = index;
          failure = err;
        }
      }
    }
  };
  const workers = Math.min(Math.max(1, Math.floor(limit)), items.length);
  await Promise.all(Array.from({ length: workers }, worker));
  if (failedAt >= 0) throw failure;
  return results;
}

/**
 * Remember an async read for as long as this wrapper lives (one sweep tick, one org — the caller builds a fresh one per
 * pass). Keyed by the read's single argument. A read that FAILS is forgotten, so the next row reads again exactly as
 * it did before this memo existed.
 */
export function memoiseRead<K, V>(read: (key: K) => Promise<V>): (key: K) => Promise<V> {
  const seen = new Map<K, Promise<V>>();
  return (key: K) => {
    const hit = seen.get(key);
    if (hit) return hit;
    const value = read(key);
    seen.set(key, value);
    value.catch(() => { if (seen.get(key) === value) seen.delete(key); });
    return value;
  };
}

/**
 * Remember a no-argument async read for as long as this wrapper lives (one pass: one org, one tick). Like
 * `memoiseRead`, a read that FAILS is forgotten, so the next caller reads again.
 */
export function onceRead<V>(read: () => Promise<V>): () => Promise<V> {
  const memo = memoiseRead((_key: true) => read());
  return () => memo(true);
}
