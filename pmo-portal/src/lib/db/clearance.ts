import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded } from '@/src/lib/appError';

/**
 * Cleared-for-site checklist DAL (#2707, migrations 1235-1237). org_id is NEVER sent (stamped by the database, ADR-0017).
 * "Cleared" and the per-item state are computed by the two database functions; nothing here recomputes them.
 */
export interface ClearanceItemRow { id: string; name: string; is_required: boolean; sort_order: number; document_type_id: string | null }
/** `document_type_id`: the item reads its dates from the person's document of that type (1612); null = dates recorded on the checklist. */
export interface ClearanceItemInput { name: string; is_required: boolean; sort_order?: number; document_type_id?: string | null }
export type ClearanceState = 'done' | 'expiring' | 'expired' | 'missing';
export interface PersonChecklistRow {
  item_id: string; name: string; is_required: boolean; sort_order: number;
  done_on: string | null; expires_on: string | null; note: string | null; state: ClearanceState;
  /** Set when the item is linked to a document type: the dates then come from the person's document (1612). */
  document_type_id: string | null; document_type_name: string | null;
}
export interface ClearanceSummaryRow { person_id: string; required_count: number; satisfied_count: number; cleared: boolean }
export interface ClearanceStateInput { done_on: string; expires_on: string | null; note: string | null }

function fail(error: { message: string; code?: string }): never { throw new AppError(error.message, error.code); }


export async function listClearanceItems(): Promise<ClearanceItemRow[]> {
  const { data, error } = await supabase.from('clearance_items').select('id, name, is_required, sort_order, document_type_id')
    .is('archived_at', null).order('sort_order', { ascending: true }).order('name', { ascending: true }).limit(500);
  if (error) fail(error);
  return data ?? [];
}
export async function createClearanceItem(input: ClearanceItemInput): Promise<void> {
  const row = { name: input.name.trim(), is_required: input.is_required, ...(input.sort_order === undefined ? {} : { sort_order: input.sort_order }), ...(input.document_type_id === undefined ? {} : { document_type_id: input.document_type_id }) };
  const { error } = await supabase.from('clearance_items').insert(row);
  if (error) fail(error);
}
export async function updateClearanceItem(id: string, patch: Partial<ClearanceItemInput> & { archived_at?: string | null }): Promise<void> {
  const fields = { ...patch, ...(patch.name === undefined ? {} : { name: patch.name.trim() }) };
  const { data, error } = await supabase.from('clearance_items').update(fields).eq('id', id).select('id');
  if (error) fail(error);
  assertWriteLanded(data, 'Checklist item not found, or you may not change it.');
}

export async function listClearanceSummary(): Promise<ClearanceSummaryRow[]> {
  const { data, error } = await supabase.rpc('person_clearance_summary');
  if (error) fail(error);
  return data ?? [];
}
export async function listPersonChecklist(personId: string): Promise<PersonChecklistRow[]> {
  const { data, error } = await supabase.rpc('person_clearance_items', { p_person: personId });
  if (error) fail(error);
  // `returns table` states no nullability, so the generated row marks every column NOT NULL; the dates, the note, the document type and the
  // state are absent/absent-until-set, and the database's own case expression bounds `state` to the four below.
  return (data ?? []).map((row) => ({
    item_id: row.item_id, name: row.name, is_required: row.is_required, sort_order: row.sort_order,
    done_on: row.done_on ?? null, expires_on: row.expires_on ?? null, note: row.note ?? null,
    state: row.state as ClearanceState,
    document_type_id: row.document_type_id ?? null, document_type_name: row.document_type_name ?? null,
  }));
}

/** One row per (person, item): update the existing row, else insert. The update grant omits the key columns on purpose. */
export async function saveClearanceState(personId: string, itemId: string, input: ClearanceStateInput): Promise<void> {
  const { data: updated, error } = await supabase.from('person_clearances').update(input).eq('person_id', personId).eq('item_id', itemId).select('id');
  if (error) fail(error);
  if (updated?.length) return;
  const { error: insertError } = await supabase.from('person_clearances').insert({ person_id: personId, item_id: itemId, ...input });
  if (insertError) fail(insertError);
}
export async function clearClearanceState(personId: string, itemId: string): Promise<void> {
  const { error } = await supabase.from('person_clearances').delete().eq('person_id', personId).eq('item_id', itemId);
  if (error) fail(error);
}
