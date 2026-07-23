import { supabase } from '@/src/lib/supabase/client';
import type { TimesheetRow, TimesheetWithEntries } from './timesheets';

// ---------------------------------------------------------------------------
// Type contract (plan §1.6)
// ---------------------------------------------------------------------------

export type TimesheetStatus = TimesheetRow['status'];

/** A timesheet in the approval queue: joined to owner full_name. */
export type TimesheetAwaitingApproval = TimesheetWithEntries & {
  owner: { full_name: string } | null;
};

// ---------------------------------------------------------------------------
// Transition map (OD-TS-2 config seam — single TS source, mirrors the SQL
// literal inside transition_timesheet(), AC-900, FR-TS-001)
// ---------------------------------------------------------------------------

export const LEGAL_TIMESHEET_TRANSITIONS: Record<string, string[]> = {
  Draft:     ['Submitted'],
  Submitted: ['Approved', 'Rejected'],
  Rejected:  ['Draft'],
  // Slice A (FR-TSC-001): `Approved` is no longer terminal — an approver may re-open an Approved
  // sheet with no confirmed ERP document (the RPC's race-safe precondition gates the live-doc case).
  Approved:  ['Draft'],
};

/**
 * Returns true when (from → to) is in the legal transition map (AC-900, FR-TS-001).
 * Pure function; mirrors the map literal in transition_timesheet().
 */
export function isLegalTimesheetTransition(
  from: TimesheetStatus,
  to: TimesheetStatus,
): boolean {
  const allowed = LEGAL_TIMESHEET_TRANSITIONS[from as string];
  if (!allowed) return false;
  return allowed.includes(to as string);
}

// ---------------------------------------------------------------------------
// Cosmetic action-gate helper (AC-901, FR-TS-004/005)
// The RPC is the real authority — this gates the UI affordances only.
// ---------------------------------------------------------------------------

/**
 * Returns the set of actions available to a user viewing a timesheet.
 * isOwner = caller is the timesheet's user_id owner.
 * isApprover = caller has manager/admin authority for this sheet (RPC decides authoritatively).
 */
export function timesheetActions(
  status: TimesheetStatus,
  isOwner: boolean,
  isApprover: boolean,
): { submit: boolean; approve: boolean; reject: boolean; reopen: boolean } {
  const submit = status === 'Draft' && isOwner;
  // SoD: owner can never approve/reject their own sheet (even if they are technically an approver)
  const approve = status === 'Submitted' && isApprover && !isOwner;
  const reject = status === 'Submitted' && isApprover && !isOwner;
  // Slice A (FR-TSC-020/021): an APPROVER (never the owner — SoD) may re-open an Approved sheet.
  // UX-only: the security-definer RPC re-derives authority AND the race-safe precondition (no live
  // ERP doc / no in-flight push) server-side. The owner is excluded even if they are an approver.
  const reopen = status === 'Approved' && isApprover && !isOwner;
  return { submit, approve, reject, reopen };
}

// ---------------------------------------------------------------------------
// DAL writes — thin RPC wrappers (AC-902, FR-TS-002/010)
// org_id is NEVER sent; the security-definer RPC re-asserts org from auth context.
// ---------------------------------------------------------------------------

/**
 * Transitions a timesheet to 'Submitted'. Throws and surfaces any RPC error.
 * org_id is NEVER sent (AC-902, FR-TS-009/010).
 */
export async function submitTimesheet(id: string): Promise<void> {
  const { error } = await supabase.rpc('transition_timesheet', {
    p_timesheet_id: id,
    p_to: 'Submitted',

  });
  if (error) throw new Error(error.message);
}

/**
 * Transitions a timesheet to 'Approved'. Throws and surfaces any RPC error.
 * org_id is NEVER sent (AC-902, FR-TS-009/010).
 */
export async function approveTimesheet(id: string, notes?: string): Promise<void> {
  const { error } = await supabase.rpc('transition_timesheet', {
    p_timesheet_id: id,
    p_to: 'Approved',
    p_notes: notes,
  });
  if (error) throw new Error(error.message);
}

/**
 * Transitions a timesheet to 'Rejected'. Throws and surfaces any RPC error.
 * org_id is NEVER sent (AC-902, FR-TS-009/010).
 */
export async function rejectTimesheet(id: string, notes?: string): Promise<void> {
  const { error } = await supabase.rpc('transition_timesheet', {
    p_timesheet_id: id,
    p_to: 'Rejected',
    // Regenerated RPC arg types encode optionals as `string | undefined` — omit, never null.
    p_notes: notes,
  });
  if (error) throw new Error(error.message);
}

/**
 * Reopens a Rejected timesheet back to Draft (AC-W3-B1, LEGAL_TIMESHEET_TRANSITIONS Rejected→Draft).
 * Single-click routine reversible step — no confirm dialog (OD-UX-1).
 * org_id is NEVER sent (AC-902, FR-TS-009/010).
 */
export async function reopenTimesheet(id: string): Promise<void> {
  const { error } = await supabase.rpc('transition_timesheet', {
    p_timesheet_id: id,
    p_to: 'Draft',
  });
  if (error) throw new Error(error.message);
}

/**
 * Slice A (AC-TSC-012, FR-TSC-060) — re-opens an APPROVED timesheet to Draft. A PURE PMO transition:
 * it issues ONLY `transition_timesheet(id,'Draft')` and NO adapter/push/repositories call of any kind.
 * The security-definer RPC enforces the approver-authority + the race-safe precondition (no live ERP
 * doc, no in-flight push) server-side; org_id is NEVER sent (the RPC re-asserts org from auth context).
 * A refusal (P0001 reopen-erp-document-held / reopen-push-in-flight) is surfaced to the caller — it is
 * correct behaviour and Slice B's entry point, not an error to swallow.
 */
export async function reopenApprovedTimesheet(id: string): Promise<void> {
  const { error } = await supabase.rpc('transition_timesheet', {
    p_timesheet_id: id,
    p_to: 'Draft',
  });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// DAL read — timesheets awaiting approval (AC-903, FR-TS-011)
// ---------------------------------------------------------------------------

const AWAITING_SELECT =
  '*, owner:profiles!timesheets_user_id_fkey(full_name), entries:timesheet_entries(*, project:projects(name,code))';

/**
 * Returns Submitted timesheets visible to the caller (via RLS) excluding their own (SoD).
 * selfId is the signed-in user's id (supplied by the hook, asserted by neq; RLS is the real scope).
 * org_id is NEVER sent — RLS scopes via auth_org_id() (AC-903, FR-TS-011).
 */
export async function listTimesheetsAwaitingApproval(
  selfId: string,
): Promise<TimesheetAwaitingApproval[]> {
  const { data, error } = await supabase
    .from('timesheets')
    .select(AWAITING_SELECT)
    .eq('status', 'Submitted')
    .neq('user_id', selfId)
    .order('week_start_date', { ascending: false });
  if (error) throw new Error(error.message);
  // Normalise entry hours to number at the data boundary (mirrors listTimesheets).
  return ((data ?? []) as unknown as TimesheetAwaitingApproval[]).map(sheet => ({
    ...sheet,
    entries: sheet.entries.map(e => ({ ...e, hours: Number(e.hours) })),
  }));
}

// ---------------------------------------------------------------------------
// Slice A — re-openable Approved timesheets (AC-TSC-R3 / F5 surface honesty)
// ---------------------------------------------------------------------------

/** The ERP mirror slice the re-open surface reads (null when the sheet was never pushed). */
export type ReopenableTimesheetMirror = {
  ts_number: string | null;
  push_state: string | null;
  erp_cancelled_at: string | null;
};

/**
 * ⚑ The outbox states that mean "a push command for this sheet is NOT settled" — byte-for-byte the
 * predicate `transition_timesheet`'s Approved→Draft arm refuses on (migration 0151 §A). `failed` and
 * `confirmed` are terminal there and so are absent here: Slice A ADMITS a re-open over a rejected push
 * (it minted no ERP document), and a `confirmed` row has already written its mirror.
 */
export const NON_TERMINAL_PUSH_COMMAND_STATES = [
  'pending', 'committing', 'committed', 'quarantined', 'held',
] as const;

/** A re-openable Approved timesheet: joined to owner + entries + its ERP mirror (null = un-pushed). */
export type ReopenableApprovedTimesheet = TimesheetAwaitingApproval & {
  mirror: ReopenableTimesheetMirror | null;
  /**
   * The sheet's non-terminal push-command state, or `null` when no push is in flight.
   *
   * SHOULD-FIX 4 (Luna code review): the mirror row is written by `adapter-dispatch` AFTER the ERP call
   * settles, so a genuinely in-flight push (a queued `pending` row, a `committing` POST, a `committed`
   * row whose mirror finalize has not run) shows up as `mirror: null` — which the surface used to read
   * as "re-openable" and render an active button the server then refuses. This is the same evidence the
   * server's own precondition uses, so the surface and the RPC agree.
   */
  pushCommandState: string | null;
};

const REOPENABLE_SELECT =
  '*, owner:profiles!timesheets_user_id_fkey(full_name), entries:timesheet_entries(*, project:projects(name,code)), mirror:timesheet_erp_mirror!timesheet_erp_mirror_timesheet_id_fkey(ts_number, push_state, erp_cancelled_at)';

/**
 * Slice A (FR-TSC-060 / F5) — the Approved sheets an approver may consider re-opening: other users'
 * Approved sheets, joined to their ERP mirror so the surface can tell an UN-PUSHED sheet (re-openable
 * now) from a PUSHED one (honest "already in ERP — correction path coming" note). `timesheets_select`
 * RLS (0007 A2 manager-of clause) + `timesheet_erp_mirror_select` RLS (0136) scope both halves; this
 * fn adds none of its own (RBAC-transparent, matching the other timesheet read hooks). org_id is
 * NEVER sent.
 */
export async function listReopenableApprovedTimesheets(
  selfId: string,
): Promise<ReopenableApprovedTimesheet[]> {
  const { data, error } = await supabase
    .from('timesheets')
    .select(REOPENABLE_SELECT)
    .eq('status', 'Approved')
    .neq('user_id', selfId)
    .order('week_start_date', { ascending: false });
  if (error) throw new Error(error.message);
  const sheets = (data ?? []) as unknown as ReopenableApprovedTimesheet[];
  if (sheets.length === 0) return [];

  // The in-flight half. `external_command_outbox_select` (0096) already grants an active org member
  // this read — NO RLS is widened for the surface; org scoping is that policy's, so no org_id is sent.
  // An error here FAILS the whole query on purpose: a surface that cannot see push state must not
  // report every sheet as re-openable (that is the exact lie SHOULD-FIX 4 is about).
  const { data: commands, error: commandError } = await supabase
    .from('external_command_outbox')
    .select('pmo_record_id, state')
    .eq('domain', 'timesheets')
    .in('pmo_record_id', sheets.map(s => s.id))
    .in('state', NON_TERMINAL_PUSH_COMMAND_STATES);
  if (commandError) throw new Error(commandError.message);
  const stateById = new Map(
    ((commands ?? []) as Array<{ pmo_record_id: string; state: string }>).map(c => [c.pmo_record_id, c.state]),
  );

  return sheets.map(sheet => ({
    ...sheet,
    entries: sheet.entries.map(e => ({ ...e, hours: Number(e.hours) })),
    pushCommandState: stateById.get(sheet.id) ?? null,
  }));
}
