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
