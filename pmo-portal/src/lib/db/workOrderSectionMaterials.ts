import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import { fetchAllPages } from '@/src/lib/pagedRead';

/**
 * Per-section material (#2576, migration 1099): the allocation of a work order's planned quantity to its sections,
 * the section figures on the request form, and the material check. The database enforces the cap (the allocations of
 * an item never exceed the work order's plan), the archived-section rule and the over-plan reason; this module only
 * carries the request. org_id is never sent.
 */

export interface SectionOption { id: string; code: string; name: string }

/** The work order's live sections, in their own order: what the request form offers. */
export async function listLiveSections(workOrderId: string): Promise<SectionOption[]> {
  const rows = await fetchAllPages<SectionOption>((from, to) =>
    supabase.from('work_order_sections').select('id, code, name').eq('work_order_id', workOrderId).is('archived_at', null)
      .order('sort_order', { ascending: true }).order('id', { ascending: true }).range(from, to));
  return rows;
}

export interface SectionLinePlan { itemId: string; sectionPlanQty: number | null; sectionPriorQty: number | null }

/** The section's allocation and what is already requested on it, per item (the figures submit snapshots). */
export async function getSectionLinePlans(workOrderId: string, sectionId: string, itemIds: string[], excludeRequestId?: string | null): Promise<SectionLinePlan[]> {
  if (itemIds.length === 0) return [];
  const { data, error } = await supabase.rpc('mrq_section_plan_for', {
    p_work_order_id: workOrderId, p_section_id: sectionId, p_item_ids: itemIds, ...(excludeRequestId ? { p_exclude_request: excludeRequestId } : {}),
  });
  if (error) throw new AppError(error.message, error.code);
  return ((data ?? []) as Array<{ item_id: string; section_plan_qty: number | null; section_prior_qty: number | null }>).map((r) => ({
    itemId: r.item_id, sectionPlanQty: r.section_plan_qty === null ? null : Number(r.section_plan_qty),
    sectionPriorQty: r.section_prior_qty === null ? null : Number(r.section_prior_qty),
  }));
}

export interface SectionAllocation { id: string; sectionId: string; itemId: string; quantity: string }

export async function listAllocations(workOrderId: string): Promise<SectionAllocation[]> {
  const rows = await fetchAllPages<{ id: string; section_id: string; item_id: string; quantity: string }>((from, to) =>
    supabase.from('work_order_section_material_plan').select('id, section_id, item_id, quantity::text').eq('work_order_id', workOrderId)
      .order('id', { ascending: true }).range(from, to));
  return rows.map((r) => ({ id: r.id, sectionId: r.section_id, itemId: r.item_id, quantity: String(r.quantity) }));
}

/** Set one allocation: a positive quantity writes it, null removes it. The database refuses a figure above the work order's plan. */
export async function setAllocation(workOrderId: string, sectionId: string, itemId: string, quantity: string | null): Promise<void> {
  const { data: existing, error: readError } = await supabase.from('work_order_section_material_plan').select('id')
    .eq('section_id', sectionId).eq('item_id', itemId).maybeSingle();
  if (readError) throw new AppError(readError.message, readError.code);
  if (quantity === null) {
    if (!existing) return;
    const { error } = await supabase.from('work_order_section_material_plan').delete().eq('id', existing.id);
    if (error) throw new AppError(error.message, error.code);
    return;
  }
  const q = Number(quantity);
  const result = existing
    ? await supabase.from('work_order_section_material_plan').update({ quantity: q }).eq('id', existing.id)
    : await supabase.from('work_order_section_material_plan').insert({ work_order_id: workOrderId, section_id: sectionId, item_id: itemId, quantity: q });
  if (result.error) throw new AppError(result.error.message, result.error.code);
}

export interface MaterialCheckRow {
  /** null = the unsectioned remainder. */
  sectionId: string | null;
  itemId: string;
  /** The section's allocation (null = none); for the remainder, the work order's plan no section took. */
  planQty: number | null;
  requestedQty: number;
  remainingQty: number | null;
  workOrderPlanQty: number;
  overAllocated: boolean;
}

export async function getMaterialCheck(workOrderId: string): Promise<MaterialCheckRow[]> {
  const { data, error } = await supabase.rpc('work_order_section_material_check', { p_work_order_id: workOrderId });
  if (error) throw new AppError(error.message, error.code);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    sectionId: (r.section_id as string | null) ?? null, itemId: String(r.item_id),
    planQty: r.plan_qty == null ? null : Number(r.plan_qty), requestedQty: Number(r.requested_qty),
    remainingQty: r.remaining_qty == null ? null : Number(r.remaining_qty), workOrderPlanQty: Number(r.work_order_plan_qty),
    overAllocated: r.over_allocated === true,
  }));
}
