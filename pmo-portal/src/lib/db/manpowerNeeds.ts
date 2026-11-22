import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import { fetchAllRowsByKeyset } from '@/src/lib/pagedRead';

/**
 * Manpower needs (migrations 1740-1741): a position and head count wanted by a date, with the people proposed linked to it.
 * The database owns every rule (live references, the work order of the need's project, one link per person, no link past the
 * head count). Progress is read from `manpower_need_progress()`, which joins the cleared-for-site function; nothing here
 * recomputes "cleared". org_id is never sent: a column default and a trigger stamp it (ADR-0017).
 */
export type ManpowerStatus = 'open' | 'met' | 'cancelled';

export interface ManpowerNeedRow {
  id: string;
  project_id: string;
  discipline_id: string;
  headcount: number;
  needed_by: string;
  work_order_id: string | null;
  crew_id: string | null;
  note: string | null;
  status: ManpowerStatus;
}

export interface ManpowerNeedInput {
  project_id: string;
  discipline_id: string;
  headcount: number;
  needed_by: string;
  work_order_id?: string | null;
  crew_id?: string | null;
  note?: string | null;
}

export type ManpowerNeedPatch = Partial<Omit<ManpowerNeedInput, 'project_id'>> & { status?: ManpowerStatus };

export interface ManpowerProgressRow {
  need_id: string;
  asked: number;
  linked: number;
  /** Null where the caller is not shown who is cleared (the screen shows a dash). */
  filled: number | null;
  in_progress: number | null;
  open_count: number;
}

export interface ManpowerToFillRow { need_id: string; project_id: string; needed_by: string; open_count: number }

export interface ManpowerLinkRow { id: string; need_id: string; person_id: string }

const COLUMNS = 'id, project_id, discipline_id, headcount, needed_by, work_order_id, crew_id, note, status';
function fail(error: { message: string; code?: string }): never { throw new AppError(error.message, error.code); }

/** Open needs first by date, then the others; paged on the key so a large organisation is read whole. */
export async function listManpowerNeeds(): Promise<ManpowerNeedRow[]> {
  const rows = await fetchAllRowsByKeyset<ManpowerNeedRow>(async (afterId, limit) => {
    let q = supabase.from('manpower_needs').select(COLUMNS).order('id', { ascending: true });
    if (afterId !== null) q = q.gt('id', afterId);
    const { data, error } = await q.limit(limit);
    return { data: (data ?? []) as ManpowerNeedRow[], error };
  });
  const rank = (s: ManpowerStatus) => (s === 'open' ? 0 : s === 'met' ? 1 : 2);
  return rows.sort((a, b) => rank(a.status) - rank(b.status) || a.needed_by.localeCompare(b.needed_by) || a.id.localeCompare(b.id));
}

export async function listManpowerProgress(): Promise<ManpowerProgressRow[]> {
  const { data, error } = await supabase.rpc('manpower_need_progress');
  if (error) fail(error);
  return data ?? [];
}

export async function listManpowerLinks(): Promise<ManpowerLinkRow[]> {
  const rows = await fetchAllRowsByKeyset<ManpowerLinkRow>(async (afterId, limit) => {
    let q = supabase.from('manpower_need_people').select('id, need_id, person_id').order('id', { ascending: true });
    if (afterId !== null) q = q.gt('id', afterId);
    const { data, error } = await q.limit(limit);
    return { data: data ?? [], error };
  });
  return rows;
}

export async function createManpowerNeed(input: ManpowerNeedInput): Promise<void> {
  const { error } = await supabase.from('manpower_needs').insert({
    project_id: input.project_id, discipline_id: input.discipline_id, headcount: input.headcount, needed_by: input.needed_by,
    work_order_id: input.work_order_id ?? null, crew_id: input.crew_id ?? null, note: input.note?.trim() || null,
  });
  if (error) fail(error);
}

export async function updateManpowerNeed(id: string, patch: ManpowerNeedPatch): Promise<void> {
  const fields = { ...patch, ...(patch.note === undefined ? {} : { note: patch.note?.trim() || null }) };
  const { data, error } = await supabase.from('manpower_needs').update(fields).eq('id', id).select('id');
  if (error) fail(error);
  if (!data?.length) throw new AppError('Need not found, or you may not change it.', 'not-found');
}

export async function linkManpowerPerson(needId: string, personId: string): Promise<void> {
  const { error } = await supabase.from('manpower_need_people').insert({ need_id: needId, person_id: personId });
  if (error) fail(error);
}

export async function unlinkManpowerPerson(linkId: string): Promise<void> {
  const { error } = await supabase.from('manpower_need_people').delete().eq('id', linkId);
  if (error) fail(error);
}

/** The database's own answer to "may I write here" (existing crew authority or the HR capability), so the screen never guesses. */
export async function canManageManpower(): Promise<boolean> {
  const { data, error } = await supabase.rpc('manpower_can_manage');
  if (error) fail(error);
  return data === true;
}

/** Open needs with places still to fill, for the people who may write needs; the database returns nothing for anyone else. */
export async function listManpowerToFill(): Promise<ManpowerToFillRow[]> {
  const { data, error } = await supabase.rpc('my_manpower_to_fill');
  if (error) fail(error);
  return data ?? [];
}
