import { supabase } from '@/src/lib/supabase/client';

/**
 * Read-only existence probe for the import-idempotency skip decision (Deliverable 2, ADR-0027).
 * REST reads only (OD-ARCH-1) — no RPC needed for a read-only existence check.
 *
 * org_id is NEVER supplied as a filter: RLS already scopes every read to the caller's org
 * (the documented tenancy design — ADR-0016/0017). Passing `org_id = ''` here was DEAD code
 * (org_id is a UUID, never '', so the equality never matched → header idempotency silently
 * did nothing). The FK-shaped scopes that remain (`procurement_id` on record tables) are real
 * relational filters, not tenancy substitutes.
 */

export interface ImportRecordMatch { id: string; import_key: string; import_batch_id: string }

export interface ImportSkipLookup {
  listCaseRecords?(table: RecordTableName, procurementId: string, keys: string[]): Promise<ImportRecordMatch[]>;
  /** Looks up an existing procurement (case header) by (import_key, import_batch_id) within
   *  the caller's RLS-scoped org. */
  findExistingCase(importKey: string, importBatchId: string): Promise<{ id: string } | null>;
  /** Looks up an existing record row in `table` by (procurement_id, import_key, import_batch_id). */
  findExistingRecord(
    table: RecordTableName,
    procurementId: string,
    importKey: string,
    importBatchId: string,
  ): Promise<{ id: string } | null>;
  /** Looks up ANY existing row (case or record) matching import_key in a DIFFERENT batch —
   *  used for the cross-batch-collision report (FR-IDEM-006, would-collide). For record tables
   *  pass `procurementId` to scope the probe to the case; for `procurements` (case headers)
   *  RLS is the only scope needed. */
  findCrossBatchCollision(
    table: RecordTableName | 'procurements',
    importKey: string,
    excludeBatchId: string,
    procurementId?: string,
  ): Promise<{ id: string; import_batch_id: string } | null>;
}

export type RecordTableName =
  | 'purchase_requests' | 'rfqs' | 'procurement_quotations' | 'purchase_orders'
  | 'procurement_receipts' | 'procurement_invoices' | 'payments';

export const supabaseImportSkipLookup: ImportSkipLookup = {
  async listCaseRecords(table, procurementId, keys) {
    const rows: ImportRecordMatch[] = [];
    const pageSize = 200;
    const uniqueKeys = [...new Set(keys)];
    for (let start = 0; start < uniqueKeys.length; start += 100) {
      const chunk = uniqueKeys.slice(start, start + 100);
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await supabase.from(table).select('id, import_key, import_batch_id')
          .eq('procurement_id', procurementId).in('import_key', chunk)
          .not('import_batch_id', 'is', null).order('id').range(offset, offset + pageSize - 1);
        if (error) throw error;
        const page = (data ?? []) as ImportRecordMatch[];
        rows.push(...page);
        if (page.length < pageSize) break;
      }
    }
    return rows;
  },

  async findExistingCase(importKey, importBatchId) {
    const { data, error } = await supabase
      .from('procurements')
      .select('id')
      .eq('import_key', importKey)
      .eq('import_batch_id', importBatchId)
      .maybeSingle();
    if (error) throw error;
    return data ?? null;
  },

  async findExistingRecord(table, procurementId, importKey, importBatchId) {
    const { data, error } = await supabase
      .from(table)
      .select('id')
      .eq('procurement_id', procurementId)
      .eq('import_key', importKey)
      .eq('import_batch_id', importBatchId)
      .maybeSingle();
    if (error) throw error;
    return data ?? null;
  },

  async findCrossBatchCollision(table, importKey, excludeBatchId, procurementId) {
    // The query builder's generic can't narrow the optional procurement_id branch here, so this
    // one read-only boundary is asserted; the exported function signature above is the real type
    // safety callers rely on.
    let query = supabase.from(table).select('id, import_batch_id') as unknown as {
      eq: (col: string, val: string) => typeof query;
      neq: (col: string, val: string) => typeof query;
      not: (col: string, op: string, val: unknown) => typeof query;
      limit: (n: number) => typeof query;
      maybeSingle: () => Promise<{ data: { id: string; import_batch_id: string } | null; error: unknown }>;
    };
    if (procurementId !== undefined) query = query.eq('procurement_id', procurementId);
    const { data, error } = await query
      .eq('import_key', importKey)
      .neq('import_batch_id', excludeBatchId)
      .not('import_batch_id', 'is', null)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ?? null;
  },
};
