import type { WorkOrderListEntry } from '@/src/lib/db/workOrderLists';

/** #2668 (FR-WAG-005): view-only grouping of a project's work orders by area or group. */
export type WorkOrderGroupBy = 'area' | 'group';

export interface WorkOrderBucket<T> {
  /** The entry id, or null for the "no area / no group" bucket (always last). */
  key: string | null;
  entry: WorkOrderListEntry | null;
  rows: T[];
}

/**
 * One bucket per entry that has rows (ordered by entry name, as `entries` arrives sorted), then the unassigned bucket.
 * Rows keep the order they came in. An entry with no rows (e.g. filtered out) gets no heading.
 */
export function bucketWorkOrders<T>(rows: T[], entries: WorkOrderListEntry[], idOf: (row: T) => string | null | undefined): WorkOrderBucket<T>[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry] as const));
  const buckets = new Map<string, WorkOrderBucket<T>>();
  const none: WorkOrderBucket<T> = { key: null, entry: null, rows: [] };
  for (const row of rows) {
    const id = idOf(row);
    const entry = id ? byId.get(id) : undefined;
    if (!id || !entry) { none.rows.push(row); continue; }
    const bucket = buckets.get(id) ?? { key: id, entry, rows: [] };
    bucket.rows.push(row);
    buckets.set(id, bucket);
  }
  const ordered = entries.map((entry) => buckets.get(entry.id)).filter((b): b is WorkOrderBucket<T> => Boolean(b));
  return none.rows.length > 0 ? [...ordered, none] : ordered;
}
