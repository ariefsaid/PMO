/**
 * erpnext-sweep/timesheetBackstop.ts (P3b task 6.4, FR-TSP-045 → AC-TSP-022, ADR-0059 §4) — the SECOND
 * originator of the timesheet push (the sweep).
 *
 * Pure orchestration over injected deps (Deno- AND Vitest-importable, exactly like `budgetBackstop.ts`,
 * which this module deliberately mirrors) — no `Deno.*`/`supabase-js` symbol crosses this file.
 * `index.ts` wires the LIVE deps (`reconcileOrgTimesheetPushesLive`) the way it wires every other
 * `*Live` pass.
 *
 * ⚑ WHY THIS PASS EXISTS. Until now the timesheet push had exactly ONE originator: the Approvals UI.
 * A push that fails after the browser dies (tab closed mid-request, dropped connection, platform 502)
 * was stranded with nothing to recover it — the same class as budget's HIGH-C, which an audit rated
 * HIGH. Budget got its backstop in P3c slice 5; timesheets did not, until this.
 *
 * ⚑ THE INVARIANTS THIS FILE ENFORCES:
 *  1. The gate is RE-ASSERTED server-side for every candidate (FR-TSP-045, ADR-0059 §3.3). The sweep
 *     carries NO user JWT and must NOT skip `approved_timesheet_for_push` "because it is trusted": that
 *     RPC is server truth for status + authorization + the entries, and passing `p_actor => the sheet's
 *     approved_by` is what lets it re-decide with no caller identity. Nothing about the push is ever
 *     decided by a payload.
 *  2. A gate REFUSAL is a recorded per-row OUTCOME, never an exception that abandons the queue. 0138's
 *     offboarding gate (a2) refuses a deactivated approver with 42501 on the RESOLVED actor — i.e.
 *     exactly the `p_actor` this pass supplies. That refusal is INTENDED (an offboarded approver must
 *     not keep posting payroll-costing hours) and must be visible, not fatal.
 *  3. ⚑ NEW-3 — PER-ROW containment. A row that throws BEFORE any outbox claim never bumps
 *     `attempt_count`, and because the queue is ordered `created_at ASC` it is FIRST again on every
 *     tick, so the org's ENTIRE automatic timesheet recovery stays off until a human intervenes. This
 *     exact wedge was an audit finding on the budget twin; it is designed out here rather than found
 *     here. Errors are RETURNED for the caller to surface — never swallowed.
 *
 * ⚑ WHAT IS NEVER RE-DRIVEN lives in the live `listPendingTimesheetPushes` QUERY, not in per-row logic
 * (the same stance as `listPendingBudgetPushes`), so it is index-served and bounded rather than fetched
 * and then discarded:
 *   • `pushed` — already succeeded;
 *   • `held`   — ADR-0058-terminal until an operator acts;
 *   • `pushing` — an in-flight claim, left to the ADR-0058 stale-claim path; NEVER a naive re-POST,
 *                 which is how a second ERP Timesheet (a duplicated week of hours) gets minted;
 *   • a TOMBSTONED row (`erp_cancelled_at not null`) — never fight the accountant (FR-TSP-084): a human
 *                 cancelled that ERP Timesheet, and re-creating it is an infinite fight with them.
 */

/** FR-TSP-045 / NFR-TSP-PERF-001: the mirror's work queue is bounded per tick (index-served on
 *  `timesheet_erp_mirror(org_id, push_state)`) so one org's backlog can never starve another's. Kept
 *  equal to the budget twin's — one tick budget, one number to reason about. */
export const TIMESHEET_BACKSTOP_TICK_LIMIT = 200;

/** One row of the mirror's own work queue.
 *
 *  ⚑ `push_state` may be the synthetic `'absent'` (AC-TSP-022): an APPROVED sheet with no mirror row at
 *  all. That is the very case this pass was written for — "the browser died before the fetch" leaves
 *  neither a mirror row nor an outbox row — so it must be a candidate, not an invisible hole. The live
 *  query derives those from `timesheets` itself; everything downstream treats them uniformly. */
export interface TimesheetMirrorCandidateRow {
  timesheet_id: string;
  push_state: string;
  erp_cancelled_at?: string | null;
}

/**
 * The sheet's own server-read push subject, handed back by the gate so a candidate with NO outbox row
 * can be driven under a REAL, recorded actor (its `approved_by`) rather than held.
 *
 * ⚑ Every field is DB truth read by `approved_timesheet_for_push` (0138), never a payload: `userId` is
 * whose cost the week becomes, `entries` are the hours that may be posted, and `approvedBy` is the
 * actor the outbox row is attributed to — the one whose CURRENT authorization + offboarding status
 * that same RPC re-asserts on every tick.
 */
export interface TimesheetPushSubject {
  approvedBy: string;
  userId: string;
  entries: unknown[];
}

/** The re-asserted gate's answer. `ok:false` is a REFUSAL (0138 raised P0001/42501 — not approved, the
 *  approver was offboarded, cross-org); a transport/DB failure THROWS instead and is contained per-row. */
export type TimesheetGateOutcome =
  | { ok: true; approvedAt: string; subject?: TimesheetPushSubject }
  | { ok: false; reason: string };

export interface TimesheetBackstopDeps {
  /** The org's ELIGIBLE mirror rows: `push_state in ('pending','failed')` and NOT tombstoned, bounded
   *  to `limit`. `pushed`/`held`/`pushing` and every tombstoned row are NEVER returned here — see the
   *  module header: the exclusions live in the query, not in extra per-row logic. */
  listPendingTimesheetPushes(orgId: string, limit: number): Promise<TimesheetMirrorCandidateRow[]>;
  /** Re-assert `approved_timesheet_for_push` under service role with `p_actor` => the sheet's
   *  `approved_by` (FR-TSP-045). Server truth for status + authz + entries; never trusts the mirror row. */
  assertApprovedForPush(row: TimesheetMirrorCandidateRow): Promise<TimesheetGateOutcome>;
  /** Record a gate refusal durably + non-silently, so an operator can see WHY a sheet stopped pushing.
   *  Never a silent drop (FR-TSP-085: the user has moved on; nothing else will ever surface this). */
  recordGateRefusal(row: TimesheetMirrorCandidateRow, reason: string): Promise<void>;
  /** Drive the still-approved sheet through the SAME dispatch path the foreground push uses, deriving
   *  the SAME deterministic key (`timesheetPushKey`) — so a race with the user's own push collides on
   *  the outbox 4-tuple (23505) and reconciles to the winner, instead of minting a SECOND ERP Timesheet.
   *  `subject` is the gate's server-read push subject, which lets the live implementation mint an
   *  ATTRIBUTED outbox row (actor = the sheet's own `approved_by`) when the foreground never reached the
   *  outbox at all. */
  driveTimesheetPush(row: TimesheetMirrorCandidateRow, approvedAt: string, subject?: TimesheetPushSubject): Promise<void>;
}

export interface ReconcileOrgTimesheetPushesResult {
  /** Rows actually driven through the dispatch path this tick. */
  driven: number;
  /** Rows whose re-asserted gate REFUSED — recorded and left as they are. An operator (or re-activating
   *  the approver) resolves them; it is not this pass's job to decide what should have happened. */
  skipped: number;
  /** NEW-3: rows that THREW. Recorded per-row so one failure cannot abandon the queue. Surfaced by the
   *  caller, never swallowed. */
  errors: Array<{ timesheetId: string; error: string }>;
}

/**
 * The sweep backstop pass (AC-TSP-022). For each of the org's eligible mirror rows, re-assert the SAME
 * precondition the foreground path's gate enforces — from DB truth, with the sheet's own approver as the
 * resolved actor — before driving anything.
 */
export async function reconcileOrgTimesheetPushes(
  deps: TimesheetBackstopDeps,
  org: { orgId: string },
): Promise<ReconcileOrgTimesheetPushesResult> {
  const candidates = await deps.listPendingTimesheetPushes(org.orgId, TIMESHEET_BACKSTOP_TICK_LIMIT);
  let driven = 0;
  let skipped = 0;
  const errors: Array<{ timesheetId: string; error: string }> = [];
  for (const row of candidates) {
    // ⚑ NEW-3 — per-row containment (see the module header). Record and continue: the row is surfaced,
    // and the rest of the queue still drains.
    try {
      const gate = await deps.assertApprovedForPush(row);
      if (!gate.ok) {
        // An INTENDED refusal (offboarded approver / no longer Approved), not a failure of the pass.
        // Durable + visible, then move on — re-driving it would just re-refuse every tick.
        await deps.recordGateRefusal(row, gate.reason);
        skipped += 1;
        continue;
      }
      await deps.driveTimesheetPush(row, gate.approvedAt, gate.subject);
      driven += 1;
    } catch (err) {
      errors.push({ timesheetId: row.timesheet_id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { driven, skipped, errors };
}
