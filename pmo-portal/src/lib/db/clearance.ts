import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded } from '@/src/lib/appError';
import { fetchAllPages } from '@/src/lib/pagedRead';

/**
 * Cleared-for-site checklist DAL (#2707, migrations 1235-1237). org_id is NEVER sent (stamped by the database, ADR-0017).
 * "Cleared" and the per-item state are computed by the two database functions; nothing here recomputes them.
 * Target dates (#2800, migrations 1831-1832): an item's optional `target_days` is written like any other column; the
 * due day and the overdue answer come from the database (`person_clearance_due`), never from the client.
 */
export interface ClearanceItemRow {
  id: string; name: string; is_required: boolean; sort_order: number; document_type_id: string | null;
  /** Optional target in days (1–365); null = the item carries no target and is never overdue. */
  target_days: number | null;
}
/** `document_type_id`: the item reads its dates from the person's document of that type (1612); null = dates recorded on the checklist. */
export interface ClearanceItemInput {
  name: string; is_required: boolean; sort_order?: number; document_type_id?: string | null;
  /** Omitted = leave the target alone / no target; null clears it (the database then clears `target_set_at`). */
  target_days?: number | null;
}
export type ClearanceState = 'done' | 'expiring' | 'expired' | 'missing';
export interface PersonChecklistRow {
  item_id: string; name: string; is_required: boolean; sort_order: number;
  done_on: string | null; expires_on: string | null; note: string | null; state: ClearanceState;
  /** Set when the item is linked to a document type: the dates then come from the person's document (1612). */
  document_type_id: string | null; document_type_name: string | null;
}
export interface ClearanceSummaryRow { person_id: string; required_count: number; satisfied_count: number; cleared: boolean }
/** One person's item that carries a due day, with the database's own overdue answer (#2800, `person_clearance_due`). */
export interface PersonClearanceDueRow { personId: string; itemId: string; dueOn: string | null; overdue: boolean }
export interface ClearanceStateInput { done_on: string; expires_on: string | null; note: string | null }

function fail(error: { message: string; code?: string }): never { throw new AppError(error.message, error.code); }


export async function listClearanceItems(): Promise<ClearanceItemRow[]> {
  const rows = await fetchAllPages((from, to) => supabase.from('clearance_items').select('id, name, is_required, sort_order, document_type_id, target_days')
    .is('archived_at', null).order('sort_order', { ascending: true }).order('name', { ascending: true }).order('id').range(from, to));
  return rows.map((r) => ({
    id: r.id, name: r.name, is_required: r.is_required, sort_order: r.sort_order,
    document_type_id: r.document_type_id, target_days: r.target_days ?? null,
  }));
}
export async function createClearanceItem(input: ClearanceItemInput): Promise<void> {
  const row = { name: input.name.trim(), is_required: input.is_required, ...(input.sort_order === undefined ? {} : { sort_order: input.sort_order }), ...(input.document_type_id === undefined ? {} : { document_type_id: input.document_type_id }), ...(input.target_days === undefined ? {} : { target_days: input.target_days }) };
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

/**
 * Every (person, item) that carries a due day, with the database's overdue answer — ONE paged read for both the
 * people list's per-person count and the person's own checklist marker (#2800, FR-CTD-009). The due day is
 * `clearance_due_on(people.created_at, item.target_set_at, item.target_days, org zone)`, computed in the database;
 * done items are already excluded there. Ordered by (person, item), a total unique order, so offset paging is safe.
 */
export async function listPersonClearanceDue(): Promise<PersonClearanceDueRow[]> {
  const rows = await fetchAllPages((from, to) => supabase.rpc('person_clearance_due')
    .order('person_id', { ascending: true }).order('item_id', { ascending: true }).range(from, to));
  // `returns table` states no nullability, so the generated row marks every column NOT NULL; `due_on` is only
  // absent when the database's own rule yields no day, and this read keeps it null rather than inventing one.
  return rows.map((row) => ({ personId: row.person_id, itemId: row.item_id, dueOn: row.due_on ?? null, overdue: row.overdue === true }));
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
