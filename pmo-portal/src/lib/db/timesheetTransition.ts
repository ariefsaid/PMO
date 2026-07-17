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
  Approved:  [],
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
): { submit: boolean; approve: boolean; reject: boolean } {
  const submit = status === 'Draft' && isOwner;
  // SoD: owner can never approve/reject their own sheet (even if they are technically an approver)
  const approve = status === 'Submitted' && isApprover && !isOwner;
  const reject = status === 'Submitted' && isApprover && !isOwner;
  return { submit, approve, reject };
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
