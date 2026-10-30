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
const NAME_LOOKUP_CHUNK_SIZE = 50;
const PROJECT_LOOKUP_CHUNK_SIZE = 200;
const MAX_CONCURRENT_NAME_LOOKUPS = 4;

type NameLookupTask = () => Promise<void>;

function distinctIds(ids: string[] | undefined): string[] {
  return [...new Set(ids ?? [])].filter(Boolean);
}

function chunksOf<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) chunks.push(items.slice(start, start + size));
  return chunks;
}

async function runNameLookupTasks(tasks: NameLookupTask[]): Promise<void> {
  let nextTask = 0;
  const failures: unknown[] = [];
  const workerCount = Math.min(MAX_CONCURRENT_NAME_LOOKUPS, tasks.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextTask < tasks.length && failures.length === 0) {
      const task = tasks[nextTask++];
      try {
        await task();
      } catch (error) {
        failures.push(error);
      }
    }
  }));
  if (failures.length > 0) throw failures[0];
}

export type HistoryNameKind = 'purchase_request' | 'rfq' | 'purchase_order' | 'payment' | 'sales_invoice' | 'procurement_invoice' | 'vendor_withholding_slip_bill' | 'project';
export interface RecordHistoryRepository {
  list(q: RecordHistoryQuery): Promise<HistoryPage>;
  /** Resolve only event IDs on the visible history page; RLS scopes every query to the caller's org. */
  lookupNames(ids: Partial<Record<HistoryNameKind, string[]>>): Promise<Record<string, Map<string, string>>>;
}

export const recordHistoryRepository: RecordHistoryRepository = {
  async lookupNames(ids) {
    const result: Record<string, Map<string, string>> = {};
    const tasks: NameLookupTask[] = [];
    const specs = [
      ['purchase_request', 'purchase_requests', 'pr_number'], ['rfq', 'rfqs', 'rfq_number'],
      ['purchase_order', 'purchase_orders', 'po_number'], ['payment', 'payments', 'pay_number'],
      ['sales_invoice', 'sales_invoices', 'pmo_number'], ['procurement_invoice', 'procurement_invoices', 'vi_number'],
    ] as const;
    for (const [kind, table, numberColumn] of specs) {
      const recordIds = distinctIds(ids[kind]);
      if (recordIds.length === 0) continue;
      const names = new Map<string, string>();
      result[kind] = names;
      for (const batch of chunksOf(recordIds, NAME_LOOKUP_CHUNK_SIZE)) {
        tasks.push(async () => {
          const { data, error } = await supabase.from(table).select(`id,${numberColumn},reference_number`).in('id', batch);
          if (error) throw toAppError(error);
          const rows = (data ?? []) as unknown as Array<{ id: string; reference_number?: string | null; [key: string]: unknown }>;
          for (const row of rows) {
            const value = row[numberColumn] || row.reference_number || '';
            if (typeof value === 'string' && value) names.set(row.id, value);
          }
        });
      }
    }
    const projectIds = distinctIds(ids.project);
    if (projectIds.length > 0) {
      const projectNames = new Map<string, string>();
      result.project = projectNames;
      for (const batch of chunksOf(projectIds, PROJECT_LOOKUP_CHUNK_SIZE)) {
        tasks.push(async () => {
          // Keep the org-scoped RLS read and archived project names used by existing history labels.
          const { data, error } = await supabase.from('projects').select('id,name').in('id', batch);
          if (error) throw toAppError(error);
          for (const row of data ?? []) projectNames.set(row.id, row.name);
        });
      }
    }
    const linkIds = distinctIds(ids.vendor_withholding_slip_bill);
    if (linkIds.length > 0) {
      const billNames = new Map<string, string>();
      result.vendor_withholding_slip_bill = billNames;
      for (const batch of chunksOf(linkIds, NAME_LOOKUP_CHUNK_SIZE)) {
        tasks.push(async () => {
          const { data, error } = await supabase.from('vendor_withholding_slip_bills')
            .select('id,invoice:procurement_invoices!vendor_withholding_slip_bills_org_id_invoice_id_fkey(vi_number,reference_number)')
            .in('id', batch);
          if (error) throw toAppError(error);
          for (const row of data ?? []) {
            const invoice = Array.isArray(row.invoice) ? row.invoice[0] : row.invoice;
            const value = invoice?.vi_number || invoice?.reference_number || '';
            if (value) billNames.set(row.id, value);
          }
        });
      }
    }
    await runNameLookupTasks(tasks);
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
