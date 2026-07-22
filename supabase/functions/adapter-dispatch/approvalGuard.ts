// P3b FR-TSP-010 — THE OWNER'S RULING, enforced server-side: a timesheet reaches the external system
// ONLY once it is Approved in PMO.
//
// Runs under the CALLER's own JWT (the deputy client — NEVER service_role), so `auth.uid()` /
// `auth_org_id()` resolve to the real actor inside `approved_timesheet_for_push` (migration 0138) and
// the org/actor arms of that RPC are evaluated against the real caller. The command payload is NEVER
// trusted to assert approved-ness: this is a DB RE-READ (ADR-0059 §3.3).
//
// It returns the sheet the RPC read, and the dispatch uses THAT — the author, the `approved_at`
// witness, and the ENTRIES — in place of whatever the payload carried. So a forged payload can decide
// neither whether a push happens nor which hours it posts.
//
// ⚑ Fail-closed by construction: every non-`ok` shape (an error, an empty result, a row with no
// `approved_at`) returns a refusal. There is no "absent ⇒ allowed" branch to fall into — the Luna
// BLOCK-4 trap (a NULL actor silently no-op'ing a gate) cannot occur here.
//
// Extracted as a pure/testable module because index.ts is integration-only (Deno.serve at module top
// level) — the decision + the RPC seam are unit-provable here (approvalGuard.test.ts).

/** Structural seam for a SECURITY DEFINER RPC invocation under the CALLER's JWT (mirrors
 *  `sodGuard.ts`'s `SodRpcClient`; kept local so this guard is Deno-importable in isolation). */
export interface ApprovalRpcClient {
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
}

/** One approved sheet, as read from the DB — the ONLY source the push body is built from. */
export interface ApprovedTimesheet {
  user_id: string;
  /** The state stamp the deterministic idempotency key and the mirror's witness are both keyed on. */
  approved_at: string;
  entries: Array<{ project_id: string; entry_date: string; hours: string; project_org_id?: string }>;
}

export interface ApprovalGuardResult {
  ok: boolean;
  status: number;
  message: string;
  /** Present only when `ok` — server truth for the command record (never a payload echo). */
  sheet?: ApprovedTimesheet;
}

/** The PMO timesheets domain (mirrors `erpnext/adapter.ts`'s `ERPNEXT_TIMESHEETS_DOMAIN` — a literal
 *  here so the guard stays dependency-free, the same idiom as `sodGuard.ts`'s REVENUE_DOMAIN). */
const TIMESHEETS_DOMAIN = 'timesheets';

/** Does this command push a PMO timesheet to the external system (and therefore need the gate)? */
export function isTimesheetPush(command: { domain: string; record: Record<string, unknown> }): boolean {
  return command.domain === TIMESHEETS_DOMAIN && command.record.erp_doc_kind === 'timesheet';
}

const REFUSED = (status: number, message: string): ApprovalGuardResult => ({ ok: false, status, message });

/**
 * Re-assert, from the database and under the caller's identity, that this timesheet is Approved and
 * that this caller may push it — BEFORE the outbox, BEFORE adapter selection, BEFORE any ERP call.
 */
export async function enforceTimesheetApproved(
  callerClient: ApprovalRpcClient,
  timesheetId: string,
): Promise<ApprovalGuardResult> {
  const { data, error } = await callerClient.rpc('approved_timesheet_for_push', { p_timesheet_id: timesheetId });

  if (error) {
    if (error.code === 'P0001') return REFUSED(422, 'timesheet-not-approved');
    if (error.code === '42501') return REFUSED(403, 'not-authorized');
    if (error.code === 'P0002') return REFUSED(404, 'not-found');
    return REFUSED(422, 'approval-check-failed');
  }

  // A set-returning RPC yields an array. No row (or a row without the state stamp the push is keyed
  // on) means the gate could not establish the precondition — refuse rather than proceed.
  const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!row || typeof row.approved_at !== 'string' || !row.approved_at || typeof row.user_id !== 'string') {
    return REFUSED(422, 'approval-check-failed');
  }

  return {
    ok: true,
    status: 200,
    message: '',
    sheet: {
      user_id: row.user_id,
      approved_at: row.approved_at,
      entries: Array.isArray(row.entries) ? (row.entries as ApprovedTimesheet['entries']) : [],
    },
  };
}
