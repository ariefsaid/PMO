import { listRecordHistory, type RecordHistoryQuery } from '@/src/lib/db/recordChanges';
import { supabase } from '@/src/lib/supabase/client';
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

export type HistoryNameKind = 'purchase_request' | 'rfq' | 'purchase_order' | 'payment' | 'sales_invoice' | 'procurement_invoice';
export interface RecordHistoryRepository {
  list(q: RecordHistoryQuery): Promise<HistoryPage>;
  /** Resolve only event IDs on the visible history page; RLS scopes every query to the caller's org. */
  lookupNames(ids: Partial<Record<HistoryNameKind, string[]>>): Promise<Record<string, Map<string, string>>>;
}

export const recordHistoryRepository: RecordHistoryRepository = {
  async lookupNames(ids) {
    const result: Record<string, Map<string, string>> = {};
    // The caller supplies ids in rendered history order; retain the newest visible events.
    const bounded = (ids: string[] | undefined) => [...new Set(ids ?? [])].filter(Boolean).slice(-50);
    const specs = [
      ['purchase_request', 'purchase_requests', 'pr_number'], ['rfq', 'rfqs', 'rfq_number'],
      ['purchase_order', 'purchase_orders', 'po_number'], ['payment', 'payments', 'pay_number'],
      ['sales_invoice', 'sales_invoices', 'pmo_number'], ['procurement_invoice', 'procurement_invoices', 'vi_number'],
    ] as const;
    await Promise.all(specs.map(async ([kind, table, numberColumn]) => {
      const recordIds = bounded(ids[kind]);
      if (recordIds.length === 0) return;
      const { data, error } = await supabase.from(table).select(`id,${numberColumn},reference_number`).in('id', recordIds);
      if (error) throw toAppError(error);
      const rows = (data ?? []) as unknown as Array<{ id: string; reference_number?: string | null; [key: string]: unknown }>;
      result[kind] = new Map(rows.flatMap((row): [string, string][] => {
        const value = row[numberColumn] || row.reference_number || '';
        return typeof value === 'string' && value ? [[row.id, value]] : [];
      }));
    }));
    return result;
  },
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
    // The RPC pages change rows by seq but returns them by created_at, and the two can disagree, so the
    // cursor is the MINIMUM seq of the page (the last row's seq could repeat a row on the next page).
    // `at` is the page's earliest created_at: the RPC's audit window starts there, so the next page's
    // audit lines (`< at`) neither repeat nor skip one. A full page of change rows means older ones may exist.
    const changes = events.filter((e) => e.source === 'change' && e.seq !== null);
    if (changes.length < limit) return { events, nextCursor: null };
    const seq = Math.min(...changes.map((e) => e.seq as number));
    const at = changes.reduce((min, e) => (Date.parse(e.createdAt) < Date.parse(min) ? e.createdAt : min), changes[0].createdAt);
    return { events, nextCursor: { seq, at } };
  },
};
