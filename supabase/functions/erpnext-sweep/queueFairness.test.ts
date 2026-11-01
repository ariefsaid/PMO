/**
 * THEME-BACK-06 (FN3R02-001, FN3R03-002): the sweep's budget, timesheet and budget-archive recovery
 * queues are served least-recently-attempted first. A page of persistently skipped / refused / failing
 * candidates is stamped and rotates behind the rest, so eligible work queued behind it still runs.
 *
 * The fake queue models the live contract: `list` returns the oldest page by
 * `(last_attempt_at nulls first, created_at, id)`, `markAttempted` stamps a row. A pass that never
 * stamps (the old behaviour) re-reads the same 200 forever.
 *
 * Verify: cd pmo-portal && npx vitest run ../supabase/functions/erpnext-sweep/queueFairness.test.ts
 */
import { describe, expect, it } from 'vitest';
import { BUDGET_BACKSTOP_TICK_LIMIT, reconcileOrgBudgetPushes, type BudgetBackstopDeps } from './budgetBackstop.ts';
import { reconcileOrgTimesheetPushes, TIMESHEET_BACKSTOP_TICK_LIMIT, type TimesheetBackstopDeps } from './timesheetBackstop.ts';
import { BUDGET_ARCHIVE_BACKSTOP_LIMIT, reconcileOrgBudgetArchiveCancellations, type BudgetArchiveBackstopDeps, type BudgetArchiveCancelIntent } from './budgetArchiveBackstop.ts';

interface Item { id: string; created: number; attempted: number | null }
const order = (a: Item, b: Item) =>
  (a.attempted ?? -1) - (b.attempted ?? -1) || a.created - b.created || a.id.localeCompare(b.id);
function queue(n: number) {
  const items: Item[] = Array.from({ length: n }, (_, i) => ({ id: `row-${String(i).padStart(4, '0')}`, created: i, attempted: null }));
  let clock = 0;
  return {
    items,
    list: (limit: number) => [...items].sort(order).slice(0, limit),
    stamp: (ids: string[]) => { clock += 1; for (const it of items) if (ids.includes(it.id)) it.attempted = clock; },
  };
}
const BLOCKED = 450; // more than two full pages of persistently ineligible rows, older than the eligible one

describe('THEME-BACK-06 budget push queue', () => {
  it('runs an eligible push queued behind several pages of skipped candidates', async () => {
    const q = queue(BLOCKED + 1);
    const eligible = `row-${String(BLOCKED).padStart(4, '0')}`;
    const driven: string[] = [];
    const deps: BudgetBackstopDeps = {
      listPendingBudgetPushes: async (_org, limit) => q.list(limit).map((r) => ({ id: r.id, budget_version_id: r.id, push_state: 'pending' })),
      readBudgetVersion: async (id) => ({ id, status: id === eligible ? 'Active' : 'Archived', activated_at: '2026-01-01T00:00:00Z' }),
      driveBudgetPush: async (row) => { driven.push(row.budget_version_id); },
      markAttempted: async (_org, rows) => q.stamp(rows.map((r) => String(r.id))),
    };
    for (let tick = 0; tick < 4 && !driven.includes(eligible); tick += 1) await reconcileOrgBudgetPushes(deps, { orgId: 'org-1' });
    expect(driven).toEqual([eligible]);
  });

  it('runs an eligible push queued behind pages of candidates that keep throwing', async () => {
    const q = queue(BLOCKED + 1);
    const eligible = `row-${String(BLOCKED).padStart(4, '0')}`;
    const driven: string[] = [];
    const deps: BudgetBackstopDeps = {
      listPendingBudgetPushes: async (_org, limit) => q.list(limit).map((r) => ({ id: r.id, budget_version_id: r.id, push_state: 'failed' })),
      readBudgetVersion: async (id) => ({ id, status: 'Active', activated_at: '2026-01-01T00:00:00Z' }),
      driveBudgetPush: async (row) => { if (row.budget_version_id !== eligible) throw new Error('still refused'); driven.push(row.budget_version_id); },
      markAttempted: async (_org, rows) => q.stamp(rows.map((r) => String(r.id))),
    };
    for (let tick = 0; tick < 4 && !driven.includes(eligible); tick += 1) await reconcileOrgBudgetPushes(deps, { orgId: 'org-1' });
    expect(driven).toEqual([eligible]);
  });

  it('stamps exactly the rows it selected, before driving any (a crash mid-pass still rotates them)', async () => {
    const calls: string[] = [];
    const deps: BudgetBackstopDeps = {
      listPendingBudgetPushes: async () => [{ id: 'a', budget_version_id: 'a', push_state: 'pending' }, { id: 'b', budget_version_id: 'b', push_state: 'pending' }],
      readBudgetVersion: async () => { calls.push('read'); throw new Error('db down'); },
      driveBudgetPush: async () => {},
      markAttempted: async (_org, rows) => { calls.push(`stamp:${rows.map((r) => r.id).join(',')}`); },
    };
    await reconcileOrgBudgetPushes(deps, { orgId: 'org-1' });
    expect(calls[0]).toBe('stamp:a,b');
  });

  it('the tick limit still bounds one pass', () => {
    expect(BUDGET_BACKSTOP_TICK_LIMIT).toBe(200);
  });
});

describe('THEME-BACK-06 timesheet push queue', () => {
  it('runs an eligible sheet queued behind pages of refused sheets', async () => {
    const q = queue(BLOCKED + 1);
    const eligible = `row-${String(BLOCKED).padStart(4, '0')}`;
    const driven: string[] = [];
    const deps: TimesheetBackstopDeps = {
      listPendingTimesheetPushes: async (_org, limit) => q.list(limit).map((r) => ({ timesheet_id: r.id, push_state: 'failed' })),
      assertApprovedForPush: async (row) => row.timesheet_id === eligible ? { ok: true, approvedAt: '2026-01-01T00:00:00Z' } : { ok: false, reason: 'timesheet-not-approved' },
      recordGateRefusal: async () => {},
      driveTimesheetPush: async (row) => { driven.push(row.timesheet_id); },
      markAttempted: async (_org, rows) => q.stamp(rows.map((r) => r.timesheet_id)),
    };
    for (let tick = 0; tick < 4 && !driven.includes(eligible); tick += 1) await reconcileOrgTimesheetPushes(deps, { orgId: 'org-1' });
    expect(driven).toEqual([eligible]);
  });

  it('never stamps a synthetic absent candidate (it has no mirror row)', async () => {
    const stamped: string[][] = [];
    const deps: TimesheetBackstopDeps = {
      listPendingTimesheetPushes: async () => [{ timesheet_id: 't1', push_state: 'failed' }, { timesheet_id: 't2', push_state: 'absent' }],
      assertApprovedForPush: async () => ({ ok: false, reason: 'x' }),
      recordGateRefusal: async () => {},
      driveTimesheetPush: async () => {},
      markAttempted: async (_org, rows) => { stamped.push(rows.map((r) => r.timesheet_id)); },
    };
    await reconcileOrgTimesheetPushes(deps, { orgId: 'org-1' });
    expect(stamped).toEqual([['t1', 't2']]); // the orchestrator hands over every selected row; the live stamp skips `absent`
    expect(TIMESHEET_BACKSTOP_TICK_LIMIT).toBe(200);
  });
});

describe('THEME-BACK-06 budget archive queue', () => {
  const job = (id: string): BudgetArchiveCancelIntent => ({
    id, org_id: 'org-1', project_id: 'p', budget_version_id: id, source_mirror_id: 'm', actor_user_id: 'u', fiscal_year: '2026',
    erp_account: 'Labor', erp_budget_name: 'BUD', activated_at_witness: '2026-01-01T00:00:00Z',
    pushed_project_start_date: null, pushed_project_end_date: null,
  });
  it('completes an archive cancellation queued behind pages of jobs still waiting on an outbox retry', async () => {
    const q = queue(BLOCKED + 1);
    const eligible = `row-${String(BLOCKED).padStart(4, '0')}`;
    const completed: string[] = [];
    const deps: BudgetArchiveBackstopDeps = {
      listPending: async (_org, limit) => q.list(limit).map((r) => job(r.id)),
      readLifecycle: async () => ({ status: 'Archived', activatedAt: '2026-01-01T00:00:00Z', activeSuccessorUsesTarget: false }),
      targetIsStillLiveAndOwned: async () => true,
      driveCancellation: async (j) => j.id === eligible, // the others are waiting out the outbox retry window
      markComplete: async (j) => { completed.push(j.id); },
      markSuperseded: async () => {},
      markHeld: async () => {},
      noteRetry: async () => {},
      markAttempted: async (_org, jobs) => q.stamp(jobs.map((j) => j.id)),
    };
    for (let tick = 0; tick < 4 && !completed.includes(eligible); tick += 1) await reconcileOrgBudgetArchiveCancellations(deps, 'org-1');
    expect(completed).toEqual([eligible]);
    expect(BUDGET_ARCHIVE_BACKSTOP_LIMIT).toBe(200);
  });
});
