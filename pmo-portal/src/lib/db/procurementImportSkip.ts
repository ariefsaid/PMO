import { supabase } from '@/src/lib/supabase/client';

/** Bounded, RLS-scoped identity reads for procurement imports. */

export interface ImportRecordMatch { id: string; import_key: string; import_batch_id: string | null; import_identity_version?: number | null; import_identity_facts?: unknown; normalized_ref?: string }

export interface ImportSkipLookup {
  normalizeCases?(refs: string[]): Promise<Map<string, string>>;
  listCases?(keys: string[]): Promise<ImportRecordMatch[]>;
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

function exactKeyFilter(keys: string[]): string {
  return `(${keys.map(key => `"${key.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`).join(',')})`;
}

async function listMatches(table: RecordTableName | 'procurements', keys: string[], procurementId?: string): Promise<ImportRecordMatch[]> {
  const rows: ImportRecordMatch[] = [];
  const pageSize = 200;
  const uniqueKeys = [...new Set(keys)];
  for (let start = 0; start < uniqueKeys.length; start += 100) {
    const chunk = uniqueKeys.slice(start, start + 100);
    let cursor: string | undefined;
    for (;;) {
      let query = supabase.from(table).select(procurementId === undefined ? 'id, import_key, import_batch_id' : 'id, import_key, import_batch_id, import_identity_version, import_identity_facts')
        .filter('import_key', 'in', exactKeyFilter(chunk)).order('id') as unknown as {
          eq(column: string, value: string): typeof query;
          gt(column: string, value: string): typeof query;
          limit(count: number): Promise<{ data: ImportRecordMatch[] | null; error: unknown }>;
        };
      if (procurementId !== undefined) query = query.eq('procurement_id', procurementId);
      if (cursor !== undefined) query = query.gt('id', cursor);
      const { data, error } = await query.limit(pageSize);
      if (error) throw error;
      if (!Array.isArray(data) || data.some(row => typeof row.id !== 'string' || typeof row.import_key !== 'string')) throw new Error('Invalid record lookup response');
      const page = data as ImportRecordMatch[];
      rows.push(...page);
      if (page.length < pageSize) break;
      cursor = page[page.length - 1].id;
    }
  }
  return rows;
}

export const supabaseImportSkipLookup: ImportSkipLookup = {
  async normalizeCases(refs) {
    const result = new Map<string, string>();
    const unique = [...new Set(refs)];
    for (let start = 0; start < unique.length; start += 200) {
      const chunk = unique.slice(start, start + 200);
      const { data, error } = await supabase.rpc('normalize_procurement_import_refs', { p_refs: chunk });
      if (error) throw error;
      if (!data || data.length !== chunk.length) throw new Error('Invalid normalization response');
      for (const row of data) {
        if (typeof row.input_ref !== 'string' || typeof row.normalized_ref !== 'string') throw new Error('Invalid normalization response');
        result.set(row.input_ref, row.normalized_ref);
      }
      if (chunk.some(ref => !result.has(ref))) throw new Error('Incomplete normalization response');
    }
    return result;
  },
  async listCases(keys) {
    const rows: ImportRecordMatch[] = [];
    const unique = [...new Set(keys)];
    for (let start = 0; start < unique.length; start += 200) {
      const refs = unique.slice(start, start + 200);
      let afterKey: string | undefined;
      let afterId: string | undefined;
      for (;;) {
        const { data, error } = await supabase.rpc('lookup_procurement_import_cases', {
          p_refs: refs, p_after_key: afterKey, p_after_id: afterId, p_limit: 200,
        });
        if (error) throw error;
        if (!data || data.some(row => typeof row.id !== 'string' || typeof row.import_key !== 'string' || typeof row.normalized_ref !== 'string')) throw new Error('Invalid case lookup response');
        rows.push(...data);
        if (data.length < 200) break;
        const last = data[data.length - 1];
        afterKey = last.normalized_ref;
        afterId = last.id;
      }
    }
    return rows;
  },

  async listCaseRecords(table, procurementId, keys) {
    return listMatches(table, keys, procurementId);
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

export async function startProcurementImportRun(): Promise<string> {
  const { data, error } = await supabase.rpc('start_procurement_import_run', {});
  if (error) throw error;
  if (typeof data !== 'string' || !data) throw new Error('Invalid import run response');
  return data;
}
