import { supabase } from '@/src/lib/supabase/client';
import type { Tables } from '@/src/lib/supabase/database.types';
import type { EntryUpsert } from '@/src/lib/timesheet-edit';
import { resolveRange, type PageParams } from '@/src/lib/pagination';

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
 *
 * Paginated (data-layer performance hardening #4, OPT-IN): passing `params.page`/
 * `params.pageSize` range-bounds the query; omitting both preserves the original unbounded
 * read for every existing caller.
 */
export async function listTimesheets(
  userId: string,
  params?: PageParams,
): Promise<TimesheetWithEntries[]> {
  const range = resolveRange(params);
  let query = supabase
    .from('timesheets')
    .select(SELECT)
    .eq('user_id', userId)
    .order('week_start_date', { ascending: false });
  if (range) query = query.range(range.from, range.to);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  // Normalise hours to number at the data boundary so callers never need Number() casts.
  return ((data ?? []) as unknown as TimesheetWithEntries[]).map(sheet => ({
    ...sheet,
    entries: sheet.entries.map(e => ({ ...e, hours: Number(e.hours) })),
  }));
}

// ---------------------------------------------------------------------------
// Write path — entry editing (timesheet-entry spec FR-TSE-017; ADR-0015).
// security-invoker posture: NO org_id / user_id-as-authority is ever sent. RLS
// (timesheets_insert + the hardened timesheet_entries_write WITH CHECK) is the
// sole authority for whose Draft sheet an entry may land on. Each fn throws a
// TimesheetWriteError preserving the PostgREST/PG error.code (mirrors
// procurementLifecycle.ts) so the hook/UI can classify the toast.
// ---------------------------------------------------------------------------

/** Shape of a PostgREST error (only the fields we surface). */
interface PostgrestErrorLike {
  message: string;
  code?: string;
}

/**
 * Carries the verbatim PostgREST message AND the Postgres error `code`
 * (e.g. `42501` RLS-rejected, `23505` unique-violation) so the UI can classify
 * the failure. Extends Error, so `err instanceof Error` / `.message` keep working.
 */
export class TimesheetWriteError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'TimesheetWriteError';
    this.code = code;
  }
}

/** Throws a TimesheetWriteError preserving both message and code. */
function throwWrite(error: PostgrestErrorLike): never {
  throw new TimesheetWriteError(error.message, error.code);
}

/**
 * Inserts a Draft timesheet for (self, weekStartDate) and returns the new row. org_id is NEVER
 * sent — the column default + the `timesheets_insert` WITH CHECK (user_id = auth.uid()) are the
 * authority. `userId` (the signed-in user) is supplied by the hook from useAuth (FR-TSE-011/017).
 */
export async function createDraftTimesheet(
  weekStartDate: string,
  userId: string,
): Promise<TimesheetRow> {
  const { data, error } = await supabase
    .from('timesheets')
    .insert({ user_id: userId, week_start_date: weekStartDate, status: 'Draft' })
    .select()
    .single();
  if (error) throwWrite(error);
  return data as TimesheetRow;
}

/**
 * Upserts entries on the (timesheet_id, project_id, entry_date) unique key (ADR-0015), so a retried
 * Save converges (FR-TSE-012/017). org_id is NEVER sent. A no-op for an empty list.
 */
export async function upsertTimesheetEntries(entries: EntryUpsert[]): Promise<void> {
  if (entries.length === 0) return;
  const { error } = await supabase
    .from('timesheet_entries')
    .upsert(entries, { onConflict: 'timesheet_id,project_id,entry_date' });
  if (error) throwWrite(error);
}

/**
 * Deletes a single entry by id (a zeroed/cleared cell). org_id is NEVER sent — RLS
 * (timesheet_entries_write USING) scopes the delete to the caller's own Draft sheet (FR-TSE-012/017).
 */
export async function deleteTimesheetEntry(id: string): Promise<void> {
  const { error } = await supabase.from('timesheet_entries').delete().eq('id', id);
  if (error) throwWrite(error);
}

/**
 * Atomic week save (reliability harden #1): create-draft-if-absent + upsert changed cells +
 * delete zeroed cells in ONE transaction via the save_timesheet_week security-definer RPC, so a
 * mid-op failure can never leave a partial commit. Returns the resolved timesheet id. org_id is
 * NEVER sent — the RPC re-asserts ownership/tenancy/Draft (mirrors the entries_write RLS).
 */
export async function saveTimesheetWeek(
  timesheetId: string | null,
  weekStartDate: string,
  upserts: EntryUpsert[],
  deleteIds: string[],
): Promise<string> {
  const { data, error } = (await supabase.rpc('save_timesheet_week', {
    p_timesheet_id: timesheetId,
    p_week_start_date: weekStartDate,
    // The RPC re-targets entries at the resolved sheet id, so timesheet_id in the payload is
    // ignored; send only the cell coordinates + values it reads (project_id/entry_date/hours/notes).
    p_upserts: upserts.map(({ project_id, entry_date, hours, notes }) => ({
      project_id,
      entry_date,
      hours,
      notes,
    })),
    p_delete_ids: deleteIds,
  })) as unknown as { data: string | null; error: PostgrestErrorLike | null };
  if (error) throwWrite(error);
  return data as string;
}
