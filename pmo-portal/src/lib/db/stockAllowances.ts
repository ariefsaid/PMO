import { supabase } from '@/src/lib/supabase/client';
import { assertWriteLanded, toAppError } from '@/src/lib/appError';

/** A material allowance: planned quantity of a stock item on one BoQ line (#1512 S5, FR-STK-050). RLS scopes who may write (PQ-7). */
export interface MaterialAllowance { id: string; boqItemId: string; itemId: string; plannedQuantity: string }
export interface MaterialAllowanceInput { id?: string; boqItemId: string; itemId: string; plannedQuantity: string }

// ponytail: planned_quantity travels as a decimal string both ways (PostgREST casts it); it never becomes a JS float (NFR-STK-007).
const asNumeric = (v: string) => v as unknown as number;

export async function listAllowances(projectId: string): Promise<MaterialAllowance[]> {
  const { data, error } = await supabase.from('boq_material_allowances')
    .select('id, boq_item_id, item_id, planned_quantity::text, boq_items!inner(project_id)')
    .eq('boq_items.project_id', projectId)
    .order('id');
  if (error) throw toAppError(error);
  return ((data ?? []) as unknown as Array<{ id: string; boq_item_id: string; item_id: string; planned_quantity: string }>)
    .map((r) => ({ id: r.id, boqItemId: r.boq_item_id, itemId: r.item_id, plannedQuantity: r.planned_quantity }));
}

/** Insert a new allowance, or change only the planned quantity of an existing one (the update grant covers that column alone). */
export async function setAllowance(i: MaterialAllowanceInput): Promise<void> {
  const { data, error } = i.id
    ? await supabase.from('boq_material_allowances').update({ planned_quantity: asNumeric(i.plannedQuantity) }).eq('id', i.id).select('id')
    : await supabase.from('boq_material_allowances').insert({ boq_item_id: i.boqItemId, item_id: i.itemId, planned_quantity: asNumeric(i.plannedQuantity) }).select('id');
  if (error) throw toAppError(error);
  assertWriteLanded(data, 'You cannot set a material allowance on this work item.');
}

export async function clearAllowance(id: string): Promise<void> {
  const { data, error } = await supabase.from('boq_material_allowances').delete().eq('id', id).select('id');
  if (error) throw toAppError(error);
  assertWriteLanded(data, 'You cannot clear this material allowance.');
}
