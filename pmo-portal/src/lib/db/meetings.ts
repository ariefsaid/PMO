import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded } from '@/src/lib/appError';
import type { Json, Tables, TablesInsert, TablesUpdate } from '@/src/lib/supabase/database.types';

export type MeetingRow = Tables<'meetings'>;
export type MeetingAttendeeRow = Tables<'meeting_attendees'>;
export type MeetingGrantRow = Tables<'meeting_access_grants'>;

/**
 * A meeting row joined with its project (name + PM) for the list/detail surfaces. The PM ride-along
 * feeds FR-MTG-034: the share panel PRE-SUGGESTS the project's PM as a one-click add (they get no
 * automatic read — inclusion is a decision someone made, never a default; DD-MTG-7).
 */
export type MeetingWithRefs = MeetingRow & {
  project: {
    id: string;
    name: string;
    project_manager_id: string | null;
    pm: { id: string; full_name: string } | null;
  } | null;
};

/** An attendee row joined with its profile / contact identity (FR-MTG-015: exactly one is set). */
export type MeetingAttendeeWithRefs = MeetingAttendeeRow & {
  profile: { id: string; full_name: string } | null;
  contact: { id: string; full_name: string } | null;
};

/**
 * A grant row joined with the granted user + granter profiles.
 *
 * ⚑ `meeting_access_grants` has TWO FKs to `profiles` (`user_id`, `granted_by`), so BOTH embeds
 * MUST be constraint-qualified (`!meeting_access_grants_user_id_fkey` etc.) — an unqualified
 * `profiles(...)` embed is ambiguous and errors at runtime (the 0177 lesson: 19 e2e specs down).
 */
export type MeetingGrantWithRefs = MeetingGrantRow & {
  user: { id: string; full_name: string } | null;
  granter: { id: string; full_name: string } | null;
};

/**
 * The v1 minutes block (spec §3 / DD-MTG-2 boundary): a typed-paragraph block and nothing else.
 * The typed `actionItem` BLOCK is ruled out of this slice — an action item is a real `tasks` row
 * linked via `tasks.meeting_id` (migration 0206), never a copy inside the document.
 */
export interface MeetingNoteBlock {
  type: 'p';
  text: string;
}

/**
 * Coerce a stored `notes` JSON value into the v1 block array, defensively: the schema asserts
 * only "array" (FR-MTG-002), so unknown block shapes flatten to their `text` (or '') rather than
 * crashing the page — a forward-compatibility guard, not a validation layer.
 */
export function parseNoteBlocks(notes: Json): MeetingNoteBlock[] {
  if (!Array.isArray(notes)) return [];
  return notes.map((b) => {
    if (b && typeof b === 'object' && !Array.isArray(b)) {
      const text = (b as { text?: unknown }).text;
      return { type: 'p' as const, text: typeof text === 'string' ? text : '' };
    }
    return { type: 'p' as const, text: typeof b === 'string' ? b : '' };
  });
}

/** The fields a create form supplies. org_id / created_by_id are NEVER among them — RLS + the
 *  0205 stamp trigger are the authority; `notes` starts as the column default `[]`. */
export interface MeetingInput {
  title: string;
  /** ISO timestamp; omitted = the column default (now()). */
  occurred_at?: string;
  location?: string | null;
  project_id?: string | null;
}

/** The fields an edit supplies. `notes_text` / `notes_search` / `notes_schema_version` are
 *  DB-owned projections (FR-MTG-005/007) and are never client-written. */
export interface MeetingPatch {
  title?: string;
  occurred_at?: string;
  location?: string | null;
  project_id?: string | null;
  notes?: MeetingNoteBlock[];
}

/** FR-MTG-030 (list): an explicit row cap + explicit ordering rather than a required filter. */
export const MEETING_LIST_CAP = 200;

/** Shape of a PostgREST/Postgres error we surface (only the fields we read). */
interface PostgrestErrorLike {
  message: string;
  code?: string;
}

function throwWrite(error: PostgrestErrorLike): never {
  throw new AppError(error.message, error.code);
}

/** The one joined select for meetings (single FK to projects, qualified anyway per house rule —
 *  and the nested `pm` embed MUST be qualified: profiles is reachable from projects via more than
 *  one FK). */
const SELECT =
  '*, project:projects!meetings_project_id_fkey(id, name, project_manager_id, pm:profiles!projects_project_manager_id_fkey(id, full_name))';

export interface MeetingListParams {
  projectId?: string;
  /** Free-text search over `notes_search` (title + notes projection, FR-MTG-011/012). */
  search?: string;
}

/**
 * List meetings visible to the caller (RLS: attendee ∪ author ∪ grant ∪ Admin, org-scoped),
 * newest-first by `occurred_at` (FR-MTG-028), excluding templates and archived rows by default
 * (FR-MTG-029), capped by MEETING_LIST_CAP (FR-MTG-030). A project filter narrows to one project;
 * without it project-less meetings are included.
 *
 * Search: `textSearch` on the stored `notes_search` tsvector with `websearch` semantics
 * (FR-MTG-011 — quoted phrases and -exclusions behave as everywhere else); the trigger builds the
 * vector with the `simple` config (0205), so the query parses with the same config. If the
 * websearch query fails (e.g. syntax the parser rejects), falls back to a plain ilike over
 * `title` + `notes_text`.
 */
export async function listMeetings(params?: MeetingListParams): Promise<MeetingWithRefs[]> {
  const build = (useFts: boolean) => {
    let query = supabase
      .from('meetings')
      .select(SELECT)
      .eq('is_template', false)
      .is('archived_at', null);
    if (params?.projectId) query = query.eq('project_id', params.projectId);
    const q = params?.search?.trim();
    if (q) {
      if (useFts) {
        query = query.textSearch('notes_search', q, { type: 'websearch', config: 'simple' });
      } else {
        const like = `%${q.replace(/[%_,()]/g, ' ').trim()}%`;
        query = query.or(`title.ilike.${like},notes_text.ilike.${like}`);
      }
    }
    return query.order('occurred_at', { ascending: false }).limit(MEETING_LIST_CAP);
  };

  const { data, error } = await build(true);
  if (error) {
    if (!params?.search?.trim()) throwWrite(error);
    const fallback = await build(false);
    if (fallback.error) throwWrite(fallback.error);
    return (fallback.data ?? []) as unknown as MeetingWithRefs[];
  }
  return (data ?? []) as unknown as MeetingWithRefs[];
}

/**
 * Fetch a single meeting by id, or null when not found / not readable (RLS: a non-attendee
 * same-org peer gets null, not an error — FR-MTG-031). Throws an `AppError` on a query error.
 */
export async function getMeeting(id: string): Promise<MeetingWithRefs | null> {
  const { data, error } = await supabase
    .from('meetings')
    .select(SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throwWrite(error);
  return (data as unknown as MeetingWithRefs) ?? null;
}

/**
 * Create a meeting (FR-MTG-030/OD-MTG-1: every role, Engineer included — the insert policy has no
 * role list). org_id and created_by_id are NEVER sent — the column default + the 0205 stamp
 * trigger supply them. Returns the new row.
 */
export async function createMeeting(input: MeetingInput): Promise<MeetingRow> {
  const row: TablesInsert<'meetings'> = {
    title: input.title,
    location: input.location || null,
    project_id: input.project_id ?? null,
  };
  if (input.occurred_at) row.occurred_at = input.occurred_at;
  const { data, error } = await supabase.from('meetings').insert(row).select().single();
  if (error) throwWrite(error);
  return data as MeetingRow;
}

/**
 * Update a meeting's header fields and/or notes (RLS: author or Admin — grants are view-only,
 * OD-MTG-2). Only the keys present in `patch` are sent; the DB recomputes `notes_text` +
 * `notes_search` from `notes` (FR-MTG-007) and the client never writes either.
 */
export async function updateMeeting(id: string, patch: MeetingPatch): Promise<void> {
  const next: TablesUpdate<'meetings'> = {};
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.occurred_at !== undefined) next.occurred_at = patch.occurred_at;
  if (patch.location !== undefined) next.location = patch.location || null;
  if (patch.project_id !== undefined) next.project_id = patch.project_id;
  if (patch.notes !== undefined) next.notes = patch.notes as unknown as Json;
  const { data, error } = await supabase.from('meetings').update(next).eq('id', id).select('id');
  if (error) throwWrite(error);
  assertWriteLanded(data, 'Meeting not found or you do not have permission to edit it.');
}

/** Soft-archive a meeting by stamping `archived_at` (FR-MTG-016, ADR-0018). */
export async function archiveMeeting(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('meetings')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');
  if (error) throwWrite(error);
  assertWriteLanded(data, 'Meeting not found or you do not have permission to archive it.');
}

/**
 * Hard-delete a meeting (Admin-only at RLS). A meeting referenced by tasks FK-blocks with 23503
 * (FR-MTG-016 — the 0206 FK carries no cascade on purpose), surfaced as "in use".
 */
export async function deleteMeeting(id: string): Promise<void> {
  const { data, error } = await supabase.from('meetings').delete().eq('id', id).select('id');
  if (error) throwWrite(error);
  assertWriteLanded(data, 'Meeting not found or you do not have permission to delete it.');
}

// ── Attendees ──────────────────────────────────────────────────────────────────────────────────

/** Exactly one identity is set per row (FR-MTG-015 — the table CHECK is the authority). */
export interface MeetingAttendeeInput {
  profile_id?: string | null;
  contact_id?: string | null;
  display_name?: string | null;
}

/** List a meeting's attendees (visible iff the meeting is), oldest-first (insertion order). */
export async function listMeetingAttendees(meetingId: string): Promise<MeetingAttendeeWithRefs[]> {
  const { data, error } = await supabase
    .from('meeting_attendees')
    .select(
      '*, profile:profiles!meeting_attendees_profile_id_fkey(id, full_name), contact:contacts!meeting_attendees_contact_id_fkey(id, full_name)',
    )
    .eq('meeting_id', meetingId)
    .order('created_at', { ascending: true });
  if (error) throwWrite(error);
  return (data ?? []) as unknown as MeetingAttendeeWithRefs[];
}

/**
 * Add an attendee (RLS: the meeting's author or Admin maintain the list). org_id is inherited
 * from the parent meeting by the 0205 stamp trigger — never sent.
 */
export async function addMeetingAttendee(
  meetingId: string,
  identity: MeetingAttendeeInput,
): Promise<MeetingAttendeeRow> {
  const { data, error } = await supabase
    .from('meeting_attendees')
    .insert({
      meeting_id: meetingId,
      profile_id: identity.profile_id ?? null,
      contact_id: identity.contact_id ?? null,
      display_name: identity.display_name?.trim() || null,
    })
    .select()
    .single();
  if (error) throwWrite(error);
  return data as MeetingAttendeeRow;
}

/** Remove an attendee row (RLS: author or Admin). */
export async function removeMeetingAttendee(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('meeting_attendees')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) throwWrite(error);
  assertWriteLanded(data, 'Attendee not found or you do not have permission to remove them.');
}

// ── Access grants (OD-MTG-2 / FR-MTG-032..034) ─────────────────────────────────────────────────

/** List a meeting's grants — see MeetingGrantWithRefs for why the embeds are qualified. */
export async function listMeetingGrants(meetingId: string): Promise<MeetingGrantWithRefs[]> {
  const { data, error } = await supabase
    .from('meeting_access_grants')
    .select(
      '*, user:profiles!meeting_access_grants_user_id_fkey(id, full_name), granter:profiles!meeting_access_grants_granted_by_fkey(id, full_name)',
    )
    .eq('meeting_id', meetingId)
    .order('granted_at', { ascending: true });
  if (error) throwWrite(error);
  return (data ?? []) as unknown as MeetingGrantWithRefs[];
}

/**
 * Grant a named user view access (FR-MTG-032/033: view-only, named users, no tiers/links/expiry).
 * `granted_by` is trigger-stamped from the caller (never trusted); the insert is audit-logged
 * server-side. RLS: anyone who can read the meeting may share it.
 */
export async function addMeetingGrant(meetingId: string, userId: string): Promise<MeetingGrantRow> {
  const { data, error } = await supabase
    .from('meeting_access_grants')
    .insert({ meeting_id: meetingId, user_id: userId })
    .select()
    .single();
  if (error) throwWrite(error);
  return data as MeetingGrantRow;
}

/** Revoke a grant (RLS: the granter, the meeting's author, or Admin). Audit-logged server-side. */
export async function revokeMeetingGrant(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('meeting_access_grants')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) throwWrite(error);
  assertWriteLanded(data, 'Grant not found or you do not have permission to revoke it.');
}
