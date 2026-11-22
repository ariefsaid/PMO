import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import { fetchAllRowsByKeyset } from '@/src/lib/pagedRead';

/**
 * #2668 (FR-WAG-001/002): the organisation's own work-order area and group lists. Two tables of one
 * shape (1382). The database stamps org_id and the author; RLS lets only an Admin write (42501);
 * a live duplicate code keeps its 23505 for the form to explain.
 */
export type WorkOrderListKind = 'area' | 'group';
const TABLE = { area: 'work_order_areas', group: 'work_order_groups' } as const;

export interface WorkOrderListEntry {
  id: string;
  code: string;
  name: string;
  archived_at: string | null;
}
export interface WorkOrderListInput {
  code: string;
  name: string;
}
/** Limits of the tables' checks (1382): a code of 1-20 characters, a name of 1-120. */
export const LIST_CODE_MAX = 20;
export const LIST_NAME_MAX = 120;

/** Every entry, live and archived (a work order may still name an archived one), by name. */
export async function listWorkOrderListEntries(kind: WorkOrderListKind): Promise<WorkOrderListEntry[]> {
  const rows = await fetchAllRowsByKeyset<WorkOrderListEntry>(async (afterId, limit) => {
    let q = supabase.from(TABLE[kind]).select('id, code, name, archived_at').order('id', { ascending: true });
    if (afterId !== null) q = q.gt('id', afterId);
    return q.limit(limit);
  });
  return rows.sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
}

export async function createWorkOrderListEntry(kind: WorkOrderListKind, input: WorkOrderListInput): Promise<void> {
  const { error } = await supabase.from(TABLE[kind]).insert({ code: input.code, name: input.name });
  if (error) throw new AppError(error.message, error.code);
}

/** An update RLS filtered out returns no row: say so, never a silent success. */
async function updateEntry(kind: WorkOrderListKind, id: string, patch: { code?: string; name?: string; archived_at?: string }): Promise<void> {
  const { data, error } = await supabase.from(TABLE[kind]).update(patch).eq('id', id).select('id');
  if (error) throw new AppError(error.message, error.code);
  if (!Array.isArray(data) || data.length === 0) throw new AppError('only an Admin can change this list', '42501');
}
export function updateWorkOrderListEntry(kind: WorkOrderListKind, id: string, input: WorkOrderListInput): Promise<void> {
  return updateEntry(kind, id, { code: input.code, name: input.name });
}
/** Soft-archive (ADR-0018): it leaves the pickers; work orders that already name it keep it. */
export function archiveWorkOrderListEntry(kind: WorkOrderListKind, id: string): Promise<void> {
  return updateEntry(kind, id, { archived_at: new Date().toISOString() });
}
