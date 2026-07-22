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
