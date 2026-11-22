import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded } from '@/src/lib/appError';

/**
 * Cleared-for-site checklist DAL (#2707, migrations 1235-1237). org_id is NEVER sent (stamped by the database, ADR-0017).
 * "Cleared" and the per-item state are computed by the two database functions; nothing here recomputes them.
 */
export interface ClearanceItemRow { id: string; name: string; is_required: boolean; sort_order: number }
export interface ClearanceItemInput { name: string; is_required: boolean; sort_order?: number }
export type ClearanceState = 'done' | 'expiring' | 'expired' | 'missing';
export interface PersonChecklistRow {
  item_id: string; name: string; is_required: boolean; sort_order: number;
  done_on: string | null; expires_on: string | null; note: string | null; state: ClearanceState;
}
export interface ClearanceSummaryRow { person_id: string; required_count: number; satisfied_count: number; cleared: boolean }
export interface ClearanceStateInput { done_on: string; expires_on: string | null; note: string | null }

function fail(error: { message: string; code?: string }): never { throw new AppError(error.message, error.code); }

/** The organisation switch (default off). Read by every active member; written by an Admin only (RLS + column grant). */
export async function getClearanceEnabled(): Promise<boolean> {
  const { data, error } = await supabase.from('organizations').select('clearance_checklist_enabled').limit(1);
  if (error) fail(error);
  return data?.[0]?.clearance_checklist_enabled === true;
}
export async function setClearanceEnabled(enabled: boolean): Promise<void> {
  // Two rows are all this needs: anything above one is refused below, and a bound keeps the read off the 1000-row cap.
  const { data: orgs, error: readError } = await supabase.from('organizations').select('id').limit(2);
  if (readError) fail(readError);
  const id = orgs?.[0]?.id;
  if (!id || (orgs?.length ?? 0) > 1) throw new AppError('No single organisation is readable for the current user', 'no-org');
  const { data, error } = await supabase.from('organizations').update({ clearance_checklist_enabled: enabled }).eq('id', id).select('id');
  if (error) fail(error);
  assertWriteLanded(data, 'You do not have permission to change this setting.');
}

export async function listClearanceItems(): Promise<ClearanceItemRow[]> {
  const { data, error } = await supabase.from('clearance_items').select('id, name, is_required, sort_order')
    .is('archived_at', null).order('sort_order', { ascending: true }).order('name', { ascending: true }).limit(500);
  if (error) fail(error);
  return data ?? [];
}
export async function createClearanceItem(input: ClearanceItemInput): Promise<void> {
  const row = { name: input.name.trim(), is_required: input.is_required, ...(input.sort_order === undefined ? {} : { sort_order: input.sort_order }) };
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
  // `returns table` states no nullability, so the generated row marks every column NOT NULL; the dates, the note and the
  // state are absent/absent-until-set, and the database's own case expression bounds `state` to the four below.
  return (data ?? []).map((row) => ({
    item_id: row.item_id, name: row.name, is_required: row.is_required, sort_order: row.sort_order,
    done_on: row.done_on ?? null, expires_on: row.expires_on ?? null, note: row.note ?? null,
    state: row.state as ClearanceState,
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
