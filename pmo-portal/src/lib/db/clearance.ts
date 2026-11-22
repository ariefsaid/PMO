import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded } from '@/src/lib/appError';

/**
 * Cleared-for-site checklist DAL (#2707, migrations 1235-1237). org_id is NEVER sent (stamped by the database, ADR-0017).
 * "Cleared" and the per-item state are computed by the two database functions; nothing here recomputes them. The tables are
 * not in the generated types until the next `supabase gen types`, so the query builder is typed here.
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const from = (name: string): any => supabase.from(name as never);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (name: string, args?: Record<string, unknown>): any => (supabase.rpc as any)(name, args);
function fail(error: { message: string; code?: string }): never { throw new AppError(error.message, error.code); }


export async function listClearanceItems(): Promise<ClearanceItemRow[]> {
  const { data, error } = await from('clearance_items').select('id, name, is_required, sort_order')
    .is('archived_at', null).order('sort_order', { ascending: true }).order('name', { ascending: true }).limit(500);
  if (error) fail(error);
  return (data ?? []) as ClearanceItemRow[];
}
export async function createClearanceItem(input: ClearanceItemInput): Promise<void> {
  const row = { name: input.name.trim(), is_required: input.is_required, ...(input.sort_order === undefined ? {} : { sort_order: input.sort_order }) };
  const { error } = await from('clearance_items').insert(row);
  if (error) fail(error);
}
export async function updateClearanceItem(id: string, patch: Partial<ClearanceItemInput> & { archived_at?: string | null }): Promise<void> {
  const fields = { ...patch, ...(patch.name === undefined ? {} : { name: patch.name.trim() }) };
  const { data, error } = await from('clearance_items').update(fields).eq('id', id).select('id');
  if (error) fail(error);
  assertWriteLanded(data, 'Checklist item not found, or you may not change it.');
}

export async function listClearanceSummary(): Promise<ClearanceSummaryRow[]> {
  const { data, error } = await rpc('person_clearance_summary');
  if (error) fail(error);
  return (data ?? []) as ClearanceSummaryRow[];
}
export async function listPersonChecklist(personId: string): Promise<PersonChecklistRow[]> {
  const { data, error } = await rpc('person_clearance_items', { p_person: personId });
  if (error) fail(error);
  return (data ?? []) as PersonChecklistRow[];
}

/** One row per (person, item): update the existing row, else insert. The update grant omits the key columns on purpose. */
export async function saveClearanceState(personId: string, itemId: string, input: ClearanceStateInput): Promise<void> {
  const { data: updated, error } = await from('person_clearances').update(input).eq('person_id', personId).eq('item_id', itemId).select('id');
  if (error) fail(error);
  if (updated?.length) return;
  const { error: insertError } = await from('person_clearances').insert({ person_id: personId, item_id: itemId, ...input });
  if (insertError) fail(insertError);
}
export async function clearClearanceState(personId: string, itemId: string): Promise<void> {
  const { error } = await from('person_clearances').delete().eq('person_id', personId).eq('item_id', itemId);
  if (error) fail(error);
}
