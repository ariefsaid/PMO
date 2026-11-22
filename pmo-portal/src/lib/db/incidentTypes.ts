import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import { fetchAllPages } from '@/src/lib/pagedRead';
import type { TablesInsert } from '@/src/lib/supabase/database.types';

/**
 * The organisation's kept list of issue types (migration 1820). Every active member reads it (the issue form picker);
 * an Admin adds, renames and archives. org_id is stamped by the database, never sent. Archiving hides a type from the
 * picker; issues that already carry it keep it (ADR-0018). A rename carries to those issues in the database.
 */
export interface IncidentTypeOption { id: string; label: string; archived_at: string | null }

const fail = (error: { message: string; code?: string }): never => { throw new AppError(error.message, error.code); };

/** Every type including archived ones (the Admin card restores from them); the form filters to live ones. */
export async function listIncidentTypes(): Promise<IncidentTypeOption[]> {
  return fetchAllPages<IncidentTypeOption>((from, to) =>
    supabase.from('incident_types').select('id, label, archived_at').order('label').order('id').range(from, to));
}

export async function addIncidentType(label: string): Promise<void> {
  // `org_id` is stamped by incident_types_stamp_org_id (1820), which introspection cannot see, so the generated Insert type
  // asks for a column the client must not send (ADR-0017).
  const { error } = await supabase.from('incident_types').insert({ label: label.trim() } as TablesInsert<'incident_types'>);
  if (error) fail(error);
}

export async function renameIncidentType(id: string, label: string): Promise<void> {
  const { error } = await supabase.from('incident_types').update({ label: label.trim() }).eq('id', id);
  if (error) fail(error);
}

export async function setIncidentTypeArchived(id: string, archived: boolean): Promise<void> {
  const { error } = await supabase.from('incident_types').update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', id);
  if (error) fail(error);
}
