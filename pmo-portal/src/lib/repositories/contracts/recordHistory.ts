import type { RecordHistoryQuery } from '@/src/lib/db/recordChanges';

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

export type HistoryNameKind = 'purchase_request' | 'rfq' | 'purchase_order' | 'payment' | 'sales_invoice' | 'procurement_invoice' | 'vendor_withholding_slip_bill' | 'project';

export interface RecordHistoryRepository {
  list(q: RecordHistoryQuery): Promise<HistoryPage>;
  /** Resolve only event IDs on the visible history page; RLS scopes every query to the caller's org. */
  lookupNames(ids: Partial<Record<HistoryNameKind, string[]>>): Promise<Record<string, Map<string, string>>>;
}
