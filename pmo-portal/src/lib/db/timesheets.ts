import { supabase } from '@/src/lib/supabase/client';
import type { Tables } from '@/src/lib/supabase/database.types';

export type TimesheetRow = Tables<'timesheets'>;
export type TimesheetEntryRow = Tables<'timesheet_entries'>;

/** An entry row with its project name/code resolved in SQL (kills render-time .find()). */
export type TimesheetEntryWithProject = TimesheetEntryRow & {
  project: { name: string; code: string | null } | null;
};

/** A timesheet header with its entries (each carrying the joined project) resolved in one query. */
export type TimesheetWithEntries = TimesheetRow & {
  entries: TimesheetEntryWithProject[];
};

const SELECT = '*, entries:timesheet_entries(*, project:projects(name,code))';

/**
 * List the given user's timesheets + entries for the caller's org. org_id is NEVER sent — RLS
 * (timesheets_select) scopes rows; passing the signed-in user's own id keeps it to own rows even
 * for manager roles (FR-DAL-TS-001). On error it throws.
 */
export async function listTimesheets(userId: string): Promise<TimesheetWithEntries[]> {
  const { data, error } = await supabase
    .from('timesheets')
    .select(SELECT)
    .eq('user_id', userId)
    .order('week_start_date', { ascending: false });
  if (error) throw new Error(error.message);
  // Normalise hours to number at the data boundary so callers never need Number() casts.
  return ((data ?? []) as unknown as TimesheetWithEntries[]).map(sheet => ({
    ...sheet,
    entries: sheet.entries.map(e => ({ ...e, hours: Number(e.hours) })),
  }));
}
