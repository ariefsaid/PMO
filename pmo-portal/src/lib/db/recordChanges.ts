import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { Database } from '@/src/lib/supabase/database.types';

/** One row of `list_record_history` (SECURITY INVOKER: each table's own RLS decides what comes back). */
export type RecordHistoryRow = Database['public']['Functions']['list_record_history']['Returns'][number];

export interface RecordHistoryQuery {
  entityType: string;
  entityId: string;
  includeChildren?: boolean;
  /** Narrow to these entity types (the project History kind filter). */
  entityTypes?: string[] | null;
  cursor?: { seq: number | null; at: string } | null;
  limit?: number;
}

/**
 * Read a record's change history. org_id is NEVER sent — the RPC and `record_changes` RLS scope the
 * org; the RPC also unions in the audit lines only an Admin/Operator can read (FR-CHG-011).
 */
export async function listRecordHistory(q: RecordHistoryQuery): Promise<RecordHistoryRow[]> {
  const { data, error } = await supabase.rpc('list_record_history', {
    p_entity_type: q.entityType,
    p_entity_id: q.entityId,
    p_include_children: q.includeChildren ?? false,
    p_entity_types: q.entityTypes ?? undefined,
    p_before_seq: q.cursor?.seq ?? undefined,
    p_before_at: q.cursor?.at ?? undefined,
    p_limit: q.limit ?? 50,
  });
  if (error) throw new AppError(error.message, error.code);
  return data ?? [];
}
