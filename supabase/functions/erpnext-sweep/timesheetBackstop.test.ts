/**
 * timesheetBackstop.test.ts (P3b task 6.4, FR-TSP-045 → AC-TSP-022) — the sweep backstop, originator 2
 * of the timesheet push.
 *
 * Why this pass exists at all: until now the push had exactly ONE originator, the Approvals UI. A push
 * that fails after the browser dies is stranded with nothing to recover it — the same class as budget's
 * HIGH-C, which an audit rated HIGH. Budget got its backstop in P3c slice 5; timesheets never did.
 *
 * Verify: cd pmo-portal && npx vitest run ../supabase/functions/erpnext-sweep/timesheetBackstop.test.ts
 *
 * Proves the PURE orchestration `timesheetBackstop.ts` owns. The live wiring
 * (`reconcileOrgTimesheetPushesLive`) is Deno-integration-only, verified by `deno check` + the
 * boot-smoke, exactly like every other `*Live` pass in this function.
 */
import { describe, it, expect } from 'vitest';
import {
  reconcileOrgTimesheetPushes,
  TIMESHEET_BACKSTOP_TICK_LIMIT,
  type TimesheetBackstopDeps,
  type TimesheetMirrorCandidateRow,
} from './timesheetBackstop';

const ORG = { orgId: 'org-a' };

interface StubOptions {
  /** The rows the LIVE query would return (already state/tombstone filtered — see the query tests). */
  candidates: TimesheetMirrorCandidateRow[];
  /** Timesheet ids whose 0138 gate REFUSES (not approved, approver offboarded, cross-org). */
  gateRefuses?: Record<string, string>;
  /** Timesheet ids whose gate call THROWS outright (a transport/DB failure, not a refusal). */
  gateThrows?: string[];
  /** Timesheet ids whose drive THROWS (e.g. ERP unreachable). */
  driveThrows?: string[];
  /** Timesheet ids whose drive throws the ADR-0058 `command-held` outcome — the sweep-driven
   *  `dispatchMoneyWrite` → `markOutboxHeld` branch (round-10 BLOCK). */
  driveHolds?: string[];
}

function stub(opts: StubOptions) {
  const gateCalls: string[] = [];
  const driven: string[] = [];
  const refusalsRecorded: Array<{ timesheetId: string; reason: string }> = [];
  let lastLimit = -1;

  const deps: TimesheetBackstopDeps = {
    listPendingTimesheetPushes: async (_orgId, limit) => {
      lastLimit = limit;
      return opts.candidates;
    },
    assertApprovedForPush: async (row) => {
      gateCalls.push(row.timesheet_id);
      if (opts.gateThrows?.includes(row.timesheet_id)) throw new Error('gate read failed: connection reset');
      const refusal = opts.gateRefuses?.[row.timesheet_id];
      return refusal ? { ok: false, reason: refusal } : { ok: true, approvedAt: '2026-07-19T02:55:21.340995+00:00' };
    },
    recordGateRefusal: async (row, reason) => {
      refusalsRecorded.push({ timesheetId: row.timesheet_id, reason });
    },
    driveTimesheetPush: async (row) => {
      if (opts.driveThrows?.includes(row.timesheet_id)) throw new Error('external-unreachable');
      if (opts.driveHolds?.includes(row.timesheet_id)) {
        // Shaped like the AppError `dispatch.ts` throws out of `claimAndCommit` after `markOutboxHeld`
        // committed the outbox to `held` (`erpnext-sweep/index.ts:1621` re-throws it here).
        throw Object.assign(new Error('money command held for operator resolution'), { code: 'command-held' });
      }
      driven.push(row.timesheet_id);
    },
  };

  return { deps, gateCalls, driven, refusalsRecorded, lastLimit: () => lastLimit };
}

const row = (timesheet_id: string, push_state = 'failed'): TimesheetMirrorCandidateRow => ({ timesheet_id, push_state });

describe('AC-TSP-022 the timesheet sweep backstop (FR-TSP-045)', () => {
  it('drives every eligible candidate, re-asserting the 0138 gate on EVERY one', async () => {
    const s = stub({ candidates: [row('ts-1'), row('ts-2', 'pending')] });

    const result = await reconcileOrgTimesheetPushes(s.deps, ORG);

    // R-SWEEP: the sweep carries NO user JWT, and must NOT skip the gate "because it is trusted".
    // The gate is server truth for status + authorization + the entries — one call per candidate, always.
    expect(s.gateCalls).toEqual(['ts-1', 'ts-2']);
    expect(s.driven).toEqual(['ts-1', 'ts-2']);
    expect(result).toEqual({ driven: 2, skipped: 0, errors: [] });
  });

  it('bounds the work queue per tick (NFR-TSP-PERF-001 — one org\'s backlog can never starve another\'s)', async () => {
    const s = stub({ candidates: [] });
    await reconcileOrgTimesheetPushes(s.deps, ORG);
    expect(s.lastLimit()).toBe(TIMESHEET_BACKSTOP_TICK_LIMIT);
  });

  it('an empty queue is a clean no-op (an org with nothing stranded does no work)', async () => {
    const s = stub({ candidates: [] });
    expect(await reconcileOrgTimesheetPushes(s.deps, ORG)).toEqual({ driven: 0, skipped: 0, errors: [] });
  });
});

describe('AC-TSP-022 a gate REFUSAL is recorded, never driven, and never a wedge', () => {
  // ⚑ 0138 (a2) refuses a deactivated approver with 42501, on the RESOLVED actor — which is exactly the
  // `p_actor => approved_by` the sweep passes. That refusal is INTENDED (an offboarded approver must
  // not keep posting payroll-costing hours), so it has to be a recorded per-row outcome, not an
  // exception that abandons the org's queue.
  it('does not push a sheet whose gate refuses, and records the reason durably', async () => {
    const s = stub({
      candidates: [row('ts-offboarded'), row('ts-ok')],
      gateRefuses: { 'ts-offboarded': 'not authorized' },
    });

    const result = await reconcileOrgTimesheetPushes(s.deps, ORG);

    expect(s.driven).toEqual(['ts-ok']);   // the refused sheet reaches NO ERP call
    expect(s.refusalsRecorded).toEqual([{ timesheetId: 'ts-offboarded', reason: 'not authorized' }]);
    expect(result.driven).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.errors).toEqual([]);   // a refusal is an OUTCOME, not a failure of the pass
  });

  it('a refusal on the FIRST row still lets the rest of the queue drain', async () => {
    const s = stub({
      candidates: [row('ts-a'), row('ts-b'), row('ts-c')],
      gateRefuses: { 'ts-a': 'timesheet-not-approved (status Submitted)' },
    });
    const result = await reconcileOrgTimesheetPushes(s.deps, ORG);
    expect(s.driven).toEqual(['ts-b', 'ts-c']);
    expect(result.skipped).toBe(1);
  });
});

/**
 * ⚑ NEW-3 (the wedge the budget backstop was fixed for, applied here BEFORE it can be found in
 * production). A row that THROWS before any outbox claim never bumps `attempt_count`; the queue is
 * ordered `created_at ASC`, so that row is FIRST again on every tick and the org's ENTIRE automatic
 * timesheet recovery stays off until a human intervenes. Per-row containment is the only thing that
 * stops one bad sheet from disabling the pass for every other sheet in the org.
 */
describe('AC-TSP-022 NEW-3 per-row containment — one throwing row can never disable the org\'s recovery', () => {
  it('a row whose DRIVE throws is recorded per-row and the queue still drains', async () => {
    const s = stub({ candidates: [row('ts-bad'), row('ts-good')], driveThrows: ['ts-bad'] });

    const result = await reconcileOrgTimesheetPushes(s.deps, ORG);

    expect(s.driven).toEqual(['ts-good']);
    expect(result.driven).toBe(1);
    expect(result.errors).toEqual([{ timesheetId: 'ts-bad', error: 'external-unreachable' }]);
  });

  it('a row whose GATE READ throws (a DB/transport failure, not a refusal) is likewise contained', async () => {
    const s = stub({ candidates: [row('ts-bad'), row('ts-good')], gateThrows: ['ts-bad'] });

    const result = await reconcileOrgTimesheetPushes(s.deps, ORG);

    expect(s.driven).toEqual(['ts-good']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].timesheetId).toBe('ts-bad');
  });

  it('the errors are RETURNED for the caller to surface — never swallowed', async () => {
    const s = stub({ candidates: [row('ts-1'), row('ts-2')], driveThrows: ['ts-1', 'ts-2'] });
    const result = await reconcileOrgTimesheetPushes(s.deps, ORG);
    expect(result.driven).toBe(0);
    expect(result.errors.map((e) => e.timesheetId)).toEqual(['ts-1', 'ts-2']);
  });
});

/**
 * ⚑ AC-TSC-R10 (Luna FU-1a round-10 BLOCK, SHOULD-FIX S2) — THE SWEEP HAS NO MIRROR FAILURE RECORDER,
 * AND THAT IS WHY THE WITNESS MUST BE STAMPED WHERE THE HOLD IS BORN.
 *
 * Every other oracle for the held path takes a mirror RECORDER as its premise: the pgTAP files drive
 * `record_timesheet_command_held`, `timesheetNotDueYet` drives the sweep's park, `dispatch.money` asserts
 * the marker on the thrown error. None of them describes THIS pass — where `dispatchMoneyWrite` commits
 * the outbox to `held` via `mark_outbox_held` and the resulting `command-held` is only contained + warned
 * about (`erpnext-sweep/index.ts:1645-1647`). That gap is exactly what round 10 exploited: the hold was
 * fenced by the outbox alone, and a `release_outbox_hold` clears the outbox.
 *
 * The fix is NOT a recorder here — adding one would repeat the enumeration mistake one level over.
 * Migration 0158 stamps `post_submit_unknown_at` inside `mark_outbox_held` itself, in the same
 * transaction as the hold, so this pass needs to record nothing for the money fence to be true. This
 * test pins the structural fact that makes that necessary, so a future reader cannot re-derive the fence
 * from "something on this path must have recorded it".
 */
describe('AC-TSC-R10 a hold produced through the SWEEP\'s dispatchMoneyWrite records nothing on the mirror', () => {
  it('AC-TSC-R10: a `command-held` from the drive is contained per-row and writes NO mirror outcome — this pass has no failure recorder, so the witness comes from `mark_outbox_held` (0158), not from here', async () => {
    const s = stub({ candidates: [row('ts-held'), row('ts-good')], driveHolds: ['ts-held'] });

    const result = await reconcileOrgTimesheetPushes(s.deps, ORG);

    // Contained, surfaced, and the queue still drains (NEW-3).
    expect(result.errors).toEqual([
      { timesheetId: 'ts-held', error: 'money command held for operator resolution' },
    ]);
    expect(s.driven).toEqual(['ts-good']);
    // ⚑ THE STRUCTURAL ASSERTION: `recordGateRefusal` is the ONLY mirror writer this pass has, and a
    // held command is not a gate refusal — so nothing on this path touches `timesheet_erp_mirror` at all.
    expect(s.refusalsRecorded).toEqual([]);
  });
});
