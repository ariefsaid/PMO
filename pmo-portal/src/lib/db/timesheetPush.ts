import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';

/**
 * The Approved-only gate read (P3b, FR-TSP-010/011) — a typed wrapper over
 * `approved_timesheet_for_push` (migration 0138).
 *
 * The FE asserts NOTHING about approval or authorization: this RPC is the authority, and it raises
 * `P0001` (not approved) / `42501` (not authorized, or cross-org) / `P0002` (unknown sheet) before a
 * command is ever built. The edge function re-runs the SAME read under the caller's JWT before any
 * ERP call (ADR-0059 §3.3) — this call exists to (a) fail fast in the UI and (b) supply the
 * `approved_at` state stamp the DETERMINISTIC idempotency key is derived from (ADR-0059 §4).
 */
export interface ApprovedTimesheetForPush {
  timesheet_id: string;
  user_id: string;
  approved_at: string;
  entries: Array<{ project_id: string; entry_date: string; hours: string; project_org_id?: string }>;
}

export async function approvedTimesheetForPush(timesheetId: string): Promise<ApprovedTimesheetForPush> {
  const { data, error } = await supabase.rpc('approved_timesheet_for_push', { p_timesheet_id: timesheetId });
  if (error) throw new AppError(error.message, error.code);
  // A set-returning RPC yields an array (never `.single()` — a 0-row read would 406, the shipped lesson).
  const row = Array.isArray(data) ? data[0] : undefined;
  if (!row || !row.approved_at) {
    throw new AppError('timesheet is not pushable (no approved row returned)', 'timesheet-not-approved');
  }
  return {
    timesheet_id: row.timesheet_id,
    user_id: row.user_id,
    approved_at: row.approved_at,
    // `entries` is a server-built jsonb array (the RPC's own jsonb_agg) — typed as Json by the
    // generator, narrowed here at the single seam that reads it.
    entries: Array.isArray(row.entries) ? (row.entries as unknown as ApprovedTimesheetForPush['entries']) : [],
  };
}

/**
 * The push-state operator surface (P3b, FR-TSP-085/173) — a typed read of the sheet's
 * `timesheet_erp_mirror` row (migration 0136). `null` when NO mirror row exists (an org that hasn't
 * flipped `timesheets`, or a sheet that hasn't reached the push path yet) — a NORMAL state, never an
 * error. The badge that consumes this must render nothing on `null`, never a blocked/error page
 * (FR-TSP-173: the ERP badge is supplementary; its absence can never gate the page's render).
 */
export interface TimesheetPushState {
  push_state: string;
  push_error: string | null;
  ts_number: string | null;
}

export async function getPushState(timesheetId: string): Promise<TimesheetPushState | null> {
  const { data, error } = await supabase
    .from('timesheet_erp_mirror')
    .select('push_state, push_error, ts_number')
    .eq('timesheet_id', timesheetId)
    .maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  return data ?? null;
}

/**
 * The Approvals "needs attention" operator surface (P3b, FR-TSP-085) — every `failed`/`held` push
 * visible to the caller, joined to its sheet's week + owner. `timesheet_erp_mirror_select` RLS (0136)
 * already scopes visibility to exactly the audience that may read the parent sheet (own / line-manager
 * / privileged) — this read adds NO further scoping, it only shapes the two failure states an operator
 * must act on. A `pending`/`pushing`/`pushed` row never appears here (nothing to act on).
 */
export interface PushNeedingAttention {
  timesheet_id: string;
  push_state: string;
  push_error: string | null;
  ts_number: string | null;
  week_start_date: string;
  approved_by: string | null;
  owner_name: string;
}

export async function listPushesNeedingAttention(): Promise<PushNeedingAttention[]> {
  const { data: mirrors, error: mirrorError } = await supabase
    .from('timesheet_erp_mirror')
    .select('timesheet_id, push_state, push_error, ts_number')
    .in('push_state', ['failed', 'held']);
  if (mirrorError) throw new AppError(mirrorError.message, mirrorError.code);
  const mirrorRows = mirrors ?? [];
  if (mirrorRows.length === 0) return [];

  const timesheetIds = mirrorRows.map((m) => m.timesheet_id);
  const { data: sheets, error: sheetsError } = await supabase
    .from('timesheets')
    .select('id, week_start_date, approved_by, owner:profiles!timesheets_user_id_fkey(full_name)')
    .in('id', timesheetIds);
  if (sheetsError) throw new AppError(sheetsError.message, sheetsError.code);

  const byId = new Map((sheets ?? []).map((s) => [s.id, s]));
  return mirrorRows.map((m) => {
    const sheet = byId.get(m.timesheet_id);
    const owner = sheet?.owner as { full_name?: string } | null | undefined;
    return {
      timesheet_id: m.timesheet_id,
      push_state: m.push_state,
      push_error: m.push_error,
      ts_number: m.ts_number,
      week_start_date: sheet?.week_start_date ?? '',
      approved_by: sheet?.approved_by ?? null,
      owner_name: owner?.full_name ?? 'Unknown',
    };
  });
}

/**
 * The Employee-adopt-link Admin queue (P3b, OQ-TSP-10(C)) — `erp_employees` rows proposed by the
 * adopt probe on a unique work-email match but NOT YET confirmed. NEVER includes `'confirmed'` or
 * `'unlinked'` rows: a proposed link is a human decision, never surfaced as already-done.
 */
export interface ProposedEmployeeLink {
  id: string;
  employee_name: string | null;
  /** ⚑ C-7 — the ERP employee's stable identifier ('HR-EMP-00087'). It was already fetched by nothing
   *  and displayed by nothing; it is often the ONLY fact that identifies a row whose name/email the
   *  ERP never filled in. */
  employee_number: string | null;
  work_email: string | null;
  link_proposed_reason: string | null;
  profile_id: string | null;
  /** ⚑ C-6 — the PMO user the hours would be attributed to. The dialog promised "the matched PMO user"
   *  and never named them, though `profile_id` was right there on the row. */
  profile_name: string | null;
  profile_email: string | null;
}

export async function listProposedEmployeeLinks(): Promise<ProposedEmployeeLink[]> {
  const { data, error } = await supabase
    .from('erp_employees')
    .select(
      'id, employee_name, employee_number, work_email, link_proposed_reason, profile_id, profile:profiles!erp_employees_profile_id_fkey(full_name, email)',
    )
    .eq('link_state', 'proposed')
    .order('employee_name', { ascending: true });
  if (error) throw new AppError(error.message, error.code);
  return (data ?? []).map((row) => {
    const profile = row.profile as { full_name?: string | null; email?: string | null } | null | undefined;
    return {
      id: row.id,
      employee_name: row.employee_name,
      employee_number: row.employee_number,
      work_email: row.work_email,
      link_proposed_reason: row.link_proposed_reason,
      profile_id: row.profile_id,
      profile_name: profile?.full_name ?? null,
      profile_email: profile?.email ?? null,
    };
  });
}

/**
 * Confirms a proposed Employee→PMO-user link (P3b, OQ-TSP-10(C) — the owner ruling: adopt-then-
 * CONFIRM, never auto-confirmed). Admin-only; the enforcement authority is the `confirm_erp_employee_link`
 * RPC itself, not this wrapper (ADR-0016 — `can('confirm_employee_link', 'employeeLink')` is UX only).
 *
 * ⚑ The RPC ships in a companion migration this slice does not own (Slice 3 / OQ-TSP-10 — the Admin
 * confirm RPC + adopt probe are explicitly deferred by migration 0136's own docstring). This wrapper is
 * written against the FROZEN CONTRACT (Admin-only, audited, propose-never-self-confirm) so the Confirm
 * affordance lights up the moment that migration lands. Until then the call surfaces a normal,
 * classifiable `AppError` (P0002/42883 "function does not exist") — never a silent success — the same
 * additive "registered but inert" posture as every other not-yet-flipped P3b seam in this plan.
 */
export async function confirmEmployeeLink(erpEmployeeId: string, profileId: string): Promise<void> {
  const { error } = await supabase.rpc(
    // Cast: not yet in the generated `Database['public']['Functions']` union (Slice 3 migration
    // pending) — see the docstring above. Remove the cast the moment `supabase gen types` picks it up.
    'confirm_erp_employee_link' as unknown as Parameters<typeof supabase.rpc>[0],
    { p_erp_employee_id: erpEmployeeId, p_profile_id: profileId } as never,
  );
  if (error) throw new AppError(error.message, error.code);
}
