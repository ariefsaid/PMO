import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import { fetchAllRowsByKeyset } from '@/src/lib/pagedRead';
import { formatDecimal, parseDecimal } from '@/src/lib/exactDecimal';

/**
 * #2668 (FR-WAG-001/002): the organisation's own work-order area and group lists. Two tables of one
 * shape (1382). The database stamps org_id and the author; RLS lets only an Admin write (42501);
 * a live duplicate code keeps its 23505 for the form to explain.
 */
export type WorkOrderListKind = 'area' | 'group';

export interface WorkOrderListEntry {
  id: string;
  code: string;
  name: string;
  /** Areas only (migration 2132): an optional note about the area. */
  description?: string | null;
  archived_at: string | null;
}
export interface WorkOrderListInput {
  code: string;
  name: string;
  /** Areas only; groups ignore it. */
  description?: string;
}
/** Limit of the area description (2132): up to 500 characters. */
export const LIST_DESCRIPTION_MAX = 500;
/** Limits of the tables' checks (1382): a code of 1-20 characters, a name of 1-120. */
export const LIST_CODE_MAX = 20;
export const LIST_NAME_MAX = 120;

/** Every entry, live and archived (a work order may still name an archived one), by name. */
export async function listWorkOrderListEntries(kind: WorkOrderListKind): Promise<WorkOrderListEntry[]> {
  const rows = await fetchAllRowsByKeyset<WorkOrderListEntry>(async (afterId, limit) => {
    if (kind === 'area') {
      let q = supabase.from('work_order_areas').select('id, code, name, description, archived_at').order('id', { ascending: true });
      if (afterId !== null) q = q.gt('id', afterId);
      return q.limit(limit);
    }
    let q = supabase.from('work_order_groups').select('id, code, name, archived_at').order('id', { ascending: true });
    if (afterId !== null) q = q.gt('id', afterId);
    return q.limit(limit);
  });
  return rows.sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
}

export async function createWorkOrderListEntry(kind: WorkOrderListKind, input: WorkOrderListInput): Promise<void> {
  const { error } = kind === 'area'
    ? await supabase.from('work_order_areas').insert({ code: input.code, name: input.name, description: input.description?.trim() || null })
    : await supabase.from('work_order_groups').insert({ code: input.code, name: input.name });
  if (error) throw new AppError(error.message, error.code);
}

/** An update RLS filtered out returns no row: say so, never a silent success. */
async function updateEntry(kind: WorkOrderListKind, id: string, patch: { code?: string; name?: string; description?: string | null; archived_at?: string }): Promise<void> {
  const { data, error } = kind === 'area'
    ? await supabase.from('work_order_areas').update(patch).eq('id', id).select('id')
    : await supabase.from('work_order_groups').update({ code: patch.code, name: patch.name, archived_at: patch.archived_at }).eq('id', id).select('id');
  if (error) throw new AppError(error.message, error.code);
  if (!Array.isArray(data) || data.length === 0) throw new AppError('only an Admin can change this list', '42501');
}
export function updateWorkOrderListEntry(kind: WorkOrderListKind, id: string, input: WorkOrderListInput): Promise<void> {
  return updateEntry(kind, id, { code: input.code, name: input.name, ...(kind === 'area' ? { description: input.description?.trim() || null } : {}) });
}
/** Soft-archive (ADR-0018): it leaves the pickers; work orders that already name it keep it. */
export function archiveWorkOrderListEntry(kind: WorkOrderListKind, id: string): Promise<void> {
  return updateEntry(kind, id, { archived_at: new Date().toISOString() });
}

/**
 * Area rates of a contract line (docs/specs/areas-and-area-rates.spec.md, migration 2132): a contract line may carry a rate per area.
 * Rates are money: the table's policy returns them only to the roles that read a daily report's revenue on the project, and a
 * security-definer RPC (`set_boq_item_area_rate`) is the only writer. A null rate removes the area's rate.
 */
export interface BoqAreaRate { areaId: string; rate: string }

/** PostgREST's generated numeric argument type is `number`, but rates must go over the wire as exact decimal text. */
const asNumericRate = (rate: string) => rate as unknown as number;

export async function listBoqItemAreaRates(boqItemId: string): Promise<BoqAreaRate[]> {
  const { data, error } = await supabase.from('boq_item_area_rates').select('area_id, rate_text:rate::text').eq('boq_item_id', boqItemId).order('area_id').limit(500);
  if (error) throw new AppError(error.message, error.code);
  return (data ?? []).map((r) => {
    const units = parseDecimal(r.rate_text, 8);
    return { areaId: r.area_id, rate: units === null ? r.rate_text : formatDecimal(units, 8, { trim: true }) };
  });
}

export async function setBoqItemAreaRate(boqItemId: string, areaId: string, rate: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_boq_item_area_rate', rate === null ? { p_boq_item: boqItemId, p_area: areaId } : { p_boq_item: boqItemId, p_area: areaId, p_rate: asNumericRate(rate) });
  if (error) throw new AppError(error.message, error.code);
}
