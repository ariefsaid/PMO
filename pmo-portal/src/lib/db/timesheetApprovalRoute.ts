import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';

/**
 * fix-waiting item 3 (FR-WAIT-006) — who ONE visible Submitted timesheet waits for, from the server-
 * computed route (`get_timesheet_approval_route`, migration 1564). The RPC is SECURITY INVOKER and
 * reads the timesheet + profiles through their existing RLS policies; it takes only the sheet id, never
 * an org id. Its approver population mirrors `transition_timesheet`'s current approve/reject authority
 * (owner SoD excluded; the raw assigned manager; Admin break-glass always; Executive only on a null raw
 * manager_id).
 *
 * The wire body is validated here: a malformed response is an error the screen can offer to retry,
 * never a fabricated approver or an empty route that reads as "nobody is needed".
 */

/** How the server described the configured route; `unavailable` is the non-leaking empty shape. */
export type TimesheetApprovalRouteKind = 'line_manager' | 'admin_executive' | 'unavailable';

export interface TimesheetApprovalRouteApprover {
  id: string;
  name: string;
  /** The coarse user_role ("Admin", "Executive", …), or the special token "line_manager". */
  role: string;
}

export interface TimesheetApprovalRoute {
  approvers: TimesheetApprovalRouteApprover[];
  routeKind: TimesheetApprovalRouteKind;
}

const ROUTE_KINDS: readonly TimesheetApprovalRouteKind[] = ['line_manager', 'admin_executive', 'unavailable'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** Narrow the RPC's jsonb to the route shape. A malformed body is an error, never a fabricated route. */
export function parseTimesheetApprovalRoute(data: unknown): TimesheetApprovalRoute {
  if (!isRecord(data) || !Array.isArray(data.approvers) || !nonEmptyString(data.route_kind)) {
    throw new AppError('The timesheet approval route response was malformed', 'timesheet-route-malformed');
  }
  if (!ROUTE_KINDS.includes(data.route_kind as TimesheetApprovalRouteKind)) {
    throw new AppError('The timesheet approval route response was malformed', 'timesheet-route-malformed');
  }
  const approvers: TimesheetApprovalRouteApprover[] = data.approvers.map((entry) => {
    // `profiles.full_name` is NOT NULL but has no non-blank invariant: a blank name is a valid server
    // value, so it is accepted and the sentence falls back to the role word. Every other field shape is
    // still strict; a malformed body remains an error, never a fabricated route.
    if (!isRecord(entry) || !nonEmptyString(entry.id) || typeof entry.name !== 'string' || !nonEmptyString(entry.role)) {
      throw new AppError('The timesheet approval route response was malformed', 'timesheet-route-malformed');
    }
    return { id: entry.id, name: entry.name.trim(), role: entry.role };
  });
  return { approvers, routeKind: data.route_kind as TimesheetApprovalRouteKind };
}

/**
 * Reads the route for ONE visible timesheet. org_id is NEVER sent — the invoker RPC's RLS (and its
 * active-caller assert) is the whole scope. A refusal (an inactive session) or a read failure throws a
 * code-bearing AppError so the screen can stay honest (plain pending text + a retry), never invent names.
 */
export async function getTimesheetApprovalRoute(timesheetId: string): Promise<TimesheetApprovalRoute> {
  const { data, error } = await supabase.rpc('get_timesheet_approval_route', {
    p_timesheet_id: timesheetId,
  });
  if (error) throw new AppError(error.message, error.code);
  return parseTimesheetApprovalRoute(data);
}
