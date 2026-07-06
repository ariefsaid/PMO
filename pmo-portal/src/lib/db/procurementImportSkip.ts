import { supabase } from '@/src/lib/supabase/client';

/**
 * Read-only existence probe for the import-idempotency skip decision (Deliverable 2, ADR-0027).
 * REST reads only (OD-ARCH-1) — no RPC needed for a read-only existence check. org_id is NEVER
 * client-supplied as a filter authority substitute; RLS still scopes every read to the caller's org,
 * this is an additional application-level filter for the specific (org, key) tuple being checked.
 */

export interface ImportSkipLookup {
  /** Looks up an existing procurement (case header) by (org_id, import_key, import_batch_id). */
  findExistingCase(orgId: string, importKey: string, importBatchId: string): Promise<{ id: string } | null>;
  /** Looks up an existing record row in `table` by (procurement_id, import_key, import_batch_id). */
  findExistingRecord(
    table: RecordTableName,
    procurementId: string,
    importKey: string,
    importBatchId: string,
  ): Promise<{ id: string } | null>;
  /** Looks up ANY existing row (case or record) matching (scope key, import_key) regardless of
   *  batch — used for the cross-batch-collision report (FR-IDEM-006, would-collide). */
  findCrossBatchCollision(
    table: RecordTableName | 'procurements',
    scopeColumn: 'org_id' | 'procurement_id',
    scopeValue: string,
    importKey: string,
    excludeBatchId: string,
  ): Promise<{ id: string; import_batch_id: string } | null>;
}

export type RecordTableName =
  | 'purchase_requests' | 'rfqs' | 'procurement_quotations' | 'purchase_orders'
  | 'procurement_receipts' | 'procurement_invoices' | 'payments';

export const supabaseImportSkipLookup: ImportSkipLookup = {
  async findExistingCase(orgId, importKey, importBatchId) {
    const { data } = await supabase
      .from('procurements')
      .select('id')
      .eq('org_id', orgId)
      .eq('import_key', importKey)
      .eq('import_batch_id', importBatchId)
      .maybeSingle();
    return data ?? null;
  },

  async findExistingRecord(table, procurementId, importKey, importBatchId) {
    const { data } = await supabase
      .from(table)
      .select('id')
      .eq('procurement_id', procurementId)
      .eq('import_key', importKey)
      .eq('import_batch_id', importBatchId)
      .maybeSingle();
    return data ?? null;
  },

  async findCrossBatchCollision(table, scopeColumn, scopeValue, importKey, excludeBatchId) {
    // `table` is a union of tables whose `scopeColumn` varies (org_id on `procurements`,
    // procurement_id on the 7 record tables) — the query builder's generic can't narrow
    // per-branch here, so the eq() column name is asserted at this one read-only boundary;
    // the exported function signature above is the real type safety callers rely on.
    const query = supabase.from(table).select('id, import_batch_id') as unknown as {
      eq: (col: string, val: string) => typeof query;
      neq: (col: string, val: string) => typeof query;
      not: (col: string, op: string, val: unknown) => typeof query;
      limit: (n: number) => typeof query;
      maybeSingle: () => Promise<{ data: { id: string; import_batch_id: string } | null }>;
    };
    const { data } = await query
      .eq(scopeColumn, scopeValue)
      .eq('import_key', importKey)
      .neq('import_batch_id', excludeBatchId)
      .not('import_batch_id', 'is', null)
      .limit(1)
      .maybeSingle();
    return data ?? null;
  },
};
