import { beforeEach, describe, expect, it, vi } from 'vitest';

// Chainable PostgREST builder mock (the agentRuns.test.ts reference pattern, extended with the
// write/insert/delete/update chain and an ordered result queue).
const h = vi.hoisted(() => {
  type Res = { data: unknown; error: unknown };
  const results: Res[] = [];
  const calls: Record<string, unknown[]> = {
    from: [], rpc: [], select: [], insert: [], update: [], delete: [], eq: [], order: [], limit: [], single: [], maybeSingle: [],
  };
  const next = (): Res => (results.length ? (results.shift() as Res) : { data: null, error: null });
  const builder: Record<string, unknown> = {};
  const rec = (name: keyof typeof calls) => (...args: unknown[]) => {
    calls[name].push(args.length <= 1 ? args[0] : args);
    return builder;
  };
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'order', 'limit'] as const) builder[m] = rec(m);
  builder.maybeSingle = () => { calls.maybeSingle.push(true); return Promise.resolve(next()); };
  builder.single = () => { calls.single.push(true); return Promise.resolve(next()); };
  builder.then = (res: (v: Res) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(next()).then(res, rej);
  const from = vi.fn((table: string) => { calls.from.push(table); return builder; });
  const rpc = vi.fn((fn: string, args?: unknown) => { calls.rpc.push(args ? [fn, args] : fn); return Promise.resolve(next()); });
  return { from, rpc, calls, results, push: (r: Res) => results.push(r) };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import {
  deleteIssueDepartmentGroup, getIssueClosingReportSettings, getIssueClosingTimeReport,
  listIssueDepartmentGroups, saveIssueDepartmentGroup, updateIssueClosingReportSettings,
} from './issueClosingReport';
import { AppError } from '@/src/lib/appError';

beforeEach(() => {
  h.from.mockClear();
  h.rpc.mockClear();
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) h.calls[k].length = 0;
  h.results.length = 0;
});

describe('issue closing report settings', () => {
  it('reads the org row with maybeSingle and passes an unconfigured org through as null', async () => {
    h.push({ data: { org_id: 'o1', enabled: true, grouping_mode: 'type' }, error: null });
    await expect(getIssueClosingReportSettings()).resolves.toMatchObject({ org_id: 'o1', enabled: true });
    expect(h.calls.from).toEqual(['issue_closing_report_settings']);
    expect(h.calls.maybeSingle).toHaveLength(1);

    h.push({ data: null, error: null });
    await expect(getIssueClosingReportSettings()).resolves.toBeNull();
  });

  it('a read refusal keeps the database error and code', async () => {
    h.push({ data: null, error: { message: 'permission denied', code: '42501' } });
    await expect(getIssueClosingReportSettings()).rejects.toMatchObject({ message: 'permission denied', code: '42501' });
    h.push({ data: null, error: { message: 'permission denied', code: '42501' } });
    await expect(getIssueClosingReportSettings()).rejects.toBeInstanceOf(AppError);
  });

  it('an existing row is patched in place, keyed by its own org, with only the given fields', async () => {
    h.push({ data: { org_id: 'o1' }, error: null }); // the current-row read
    h.push({ data: { org_id: 'o1', enabled: false, grouping_mode: 'department_groups' }, error: null }); // the update
    const saved = await updateIssueClosingReportSettings({ enabled: false, grouping_mode: 'department_groups' });
    expect(saved).toMatchObject({ grouping_mode: 'department_groups' });
    expect(h.calls.eq).toContainEqual(['org_id', 'o1']);
    const patch = h.calls.update.at(-1) as Record<string, unknown>;
    expect(patch.enabled).toBe(false);
    expect(patch.grouping_mode).toBe('department_groups');
    expect(typeof patch.updated_at).toBe('string');
    expect(h.calls.single).toHaveLength(1);
  });

  it('a patch that omits a field leaves the stored value of that field alone', async () => {
    h.push({ data: { org_id: 'o1' }, error: null });
    h.push({ data: { org_id: 'o1', enabled: true }, error: null });
    await updateIssueClosingReportSettings({ enabled: true });
    const patch = h.calls.update.at(-1) as Record<string, unknown>;
    expect(patch.enabled).toBe(true);
    expect(patch).not.toHaveProperty('grouping_mode');
  });

  it('an unconfigured org inserts the defaults: disabled, grouped by type', async () => {
    h.push({ data: null, error: null }); // no current row
    h.push({ data: { org_id: 'o1', enabled: false, grouping_mode: 'type' }, error: null });
    await expect(updateIssueClosingReportSettings({})).resolves.toMatchObject({ enabled: false, grouping_mode: 'type' });
    expect(h.calls.insert).toEqual([{ enabled: false, grouping_mode: 'type' }]);
  });
});

describe('issue department groups', () => {
  it('lists at most 200 groups ordered by name', async () => {
    h.push({ data: [{ id: 'g2', name: 'B' }, { id: 'g1', name: 'A' }], error: null });
    await expect(listIssueDepartmentGroups()).resolves.toHaveLength(2);
    expect(h.calls.from).toEqual(['issue_department_groups']);
    expect(h.calls.order).toContainEqual(['name', { ascending: true }]);
    expect(h.calls.limit).toContainEqual(200);
  });

  it('creates a group with a trimmed name and never sends org_id or an id', async () => {
    h.push({ data: { id: 'g1', name: 'Yard crew', issue_types: ['Safety'] }, error: null });
    const saved = await saveIssueDepartmentGroup({ name: '  Yard crew  ', issue_types: ['Safety'] });
    expect(saved).toMatchObject({ id: 'g1' });
    expect(h.calls.insert).toEqual([{ name: 'Yard crew', issue_types: ['Safety'] }]);
    expect(JSON.stringify(h.calls)).not.toContain('org_id');
  });

  it('updates an existing group by id and refuses a write that landed nowhere', async () => {
    h.push({ data: { id: 'g1', name: 'Renamed' }, error: null });
    await expect(saveIssueDepartmentGroup({ id: 'g1', name: ' Renamed ', issue_types: [] })).resolves.toMatchObject({ id: 'g1' });
    expect(h.calls.eq).toContainEqual(['id', 'g1']);
    const patch = h.calls.update.at(-1) as Record<string, unknown>;
    expect(patch.name).toBe('Renamed');
    expect(patch.issue_types).toEqual([]);
    expect(typeof patch.updated_at).toBe('string');

    h.push({ data: null, error: null }); // update matched no row
    await expect(saveIssueDepartmentGroup({ id: 'gone', name: 'x', issue_types: [] }))
      .rejects.toMatchObject({ code: '42501', message: expect.stringContaining('not found') });
  });

  it('delete proves it landed: a refused (FK-guarded or out-of-org) delete raises', async () => {
    h.push({ data: [{ id: 'g1' }], error: null });
    await expect(deleteIssueDepartmentGroup('g1')).resolves.toBeUndefined();

    h.push({ data: [], error: null });
    await expect(deleteIssueDepartmentGroup('g1'))
      .rejects.toMatchObject({ code: '42501', message: expect.stringContaining('permission') });
  });
});

describe('getIssueClosingTimeReport', () => {
  it('sends the filter as the RPC arguments, null when a bound is absent', async () => {
    h.push({ data: [], error: null });
    await getIssueClosingTimeReport({ dateFrom: '2026-01-01', groupingMode: 'department_groups' });
    expect(h.from).not.toHaveBeenCalled();
    expect(h.calls.rpc).toEqual([['get_issue_closing_time_report', { p_date_from: '2026-01-01', p_date_to: null, p_grouping_mode: 'department_groups' }]]);
  });

  it('normalises every figure: counts default to 0, absent hour figures stay null, department falls back to Unassigned', async () => {
    h.push({
      data: [
        { department: null, total_issues: '4', closed_issues: null, open_issues: 1, avg_closing_hours: '2.5', median_closing_hours: null, overdue_issues: undefined },
      ],
      error: null,
    },);
    await expect(getIssueClosingTimeReport({ dateFrom: '2026-01-01', dateTo: '2026-02-01', groupingMode: 'type' }))
      .resolves.toEqual([
        { department: 'Unassigned', total_issues: 4, closed_issues: 0, open_issues: 1, avg_closing_hours: 2.5, median_closing_hours: null, overdue_issues: 0 },
      ]);
  });

  it('a report refusal keeps the code', async () => {
    h.push({ data: null, error: { message: 'no such function', code: '42883' } });
    await expect(getIssueClosingTimeReport()).rejects.toMatchObject({ code: '42883' });
  });
});

describe('getWorkOrderEffectiveHours (AC-ICM-012)', () => {
  it('calls the read with the work order and range, and never shows no-times days as 0', async () => {
    const { getWorkOrderEffectiveHours } = await import('./issueClosingReport');
    h.push({ data: [
      { work_date: '2026-11-02', worked_minutes: 510, stopped_minutes: 120, effective_minutes: 390, has_times: true },
      { work_date: '2026-11-03', worked_minutes: 0, stopped_minutes: 30, effective_minutes: 0, has_times: false },
    ], error: null });
    const rows = await getWorkOrderEffectiveHours('w1', '2026-11-01', '2026-11-30');
    expect(h.calls.rpc[0]).toEqual(['get_work_order_effective_hours', { p_work_order: 'w1', p_from: '2026-11-01', p_to: '2026-11-30' }]);
    expect(rows[0]).toMatchObject({ worked_minutes: 510, effective_minutes: 390 });
    expect(rows[1]).toMatchObject({ worked_minutes: null, effective_minutes: null, stopped_minutes: 30 });
  });
});
