import { listRecordHistory, type RecordHistoryQuery } from '@/src/lib/db/recordChanges';
import { toAppError } from '@/src/lib/appError';

/** `{ old, new }` for a captured column; `{ changed: true }` for a flagged one (no values stored). */
export interface FieldChange {
  old?: unknown;
  new?: unknown;
  changed?: boolean;
}

export interface HistoryEvent {
  id: string;
  /** `change` = a `record_changes` row; `audit` = an audit_events "did X" line (Admin/Operator only). */
  source: 'change' | 'audit';
  seq: number | null;
  entityType: string;
  entityId: string;
  op: 'insert' | 'update' | null;
  action: string | null;
  /** null = system / integration writer. */
  actorId: string | null;
  changes: Record<string, FieldChange>;
  detail: Record<string, unknown> | null;
  currency: string | null;
  createdAt: string;
}

export interface HistoryCursor {
  seq: number | null;
  at: string;
}

export interface HistoryPage {
  events: HistoryEvent[];
  /** null when this was the last page. */
  nextCursor: HistoryCursor | null;
}

const DEFAULT_LIMIT = 50;

export interface RecordHistoryRepository {
  list(q: RecordHistoryQuery): Promise<HistoryPage>;
}

export const recordHistoryRepository: RecordHistoryRepository = {
  async list(q) {
    const limit = q.limit ?? DEFAULT_LIMIT;
    let rows;
    try {
      rows = await listRecordHistory({ ...q, limit });
    } catch (e) {
      throw toAppError(e);
    }
    const events: HistoryEvent[] = rows.map((r) => ({
      id: r.event_id,
      source: r.source === 'audit' ? 'audit' : 'change',
      seq: r.seq,
      entityType: r.entity_type,
      entityId: r.entity_id,
      op: r.op === 'insert' || r.op === 'update' ? r.op : null,
      action: r.action,
      actorId: r.actor_id,
      changes: (r.changes ?? {}) as Record<string, FieldChange>,
      detail: (r.detail ?? null) as Record<string, unknown> | null,
      currency: r.currency,
      createdAt: r.created_at,
    }));
    // The RPC pages change rows by seq; audit lines ride the page's created_at window. A full page of
    // change rows means older ones may exist; the next cursor is the smallest seq + created_at seen.
    const changes = events.filter((e) => e.source === 'change');
    if (changes.length < limit) return { events, nextCursor: null };
    const oldest = changes[changes.length - 1];
    return { events, nextCursor: { seq: oldest.seq, at: oldest.createdAt } };
  },
};
