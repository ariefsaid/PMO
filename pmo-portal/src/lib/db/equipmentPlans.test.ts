import { beforeEach, describe, expect, it, vi } from 'vitest';
import { monthEnd, monthStart, planTotal } from './equipmentPlans';

describe('equipment plan helpers (#2700)', () => {
  it('AC-EQP-005 a month starts on its first day and ends on its last, leap years included', () => {
    expect(monthStart(new Date(2026, 2, 17))).toBe('2026-03-01');
    expect(monthEnd('2026-03-01')).toBe('2026-03-31');
    expect(monthEnd('2026-02-01')).toBe('2026-02-28');
    expect(monthEnd('2028-02-01')).toBe('2028-02-29');
  });
  it('AC-EQP-016 the month total is exact to the cent', () => {
    expect(planTotal([{ quantity: 2, rate: 1000 }, { quantity: 1.5, rate: 333.33 }])).toBe(2500);
    expect(planTotal([])).toBe(0);
  });
});

// ── the IO surface (chainable builder mock, the agentRuns.test.ts reference pattern) ──────────────
const h = vi.hoisted(() => {
  type Res = { data: unknown; error: unknown };
  const results: Res[] = [];
  const calls: Record<string, unknown[]> = { from: [], rpc: [], select: [], eq: [], order: [], limit: [] };
  const next = (): Res => (results.length ? (results.shift() as Res) : { data: null, error: null });
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'limit'] as const) {
    builder[m] = (...a: unknown[]) => { calls[m].push(a.length <= 1 ? a[0] : a); return builder; };
  }
  builder.then = (res: (v: Res) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(next()).then(res, rej);
  const from = vi.fn((t: string) => { calls.from.push(t); return builder; });
  const rpc = vi.fn((n: string, a?: unknown) => { calls.rpc.push(a ? [n, a] : n); return Promise.resolve(next()); });
  return { from, rpc, calls, results, push: (r: Res) => results.push(r) };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import {
  approvePlan, canApprovePlan, getPlanApprovalRoute, getPlanSettings, listPlanCategories, listPlansForMonth,
  parsePlanApprovalRoute, rejectPlan, reopenPlan, savePlan, setPlanCategoryActive, setPlanSettings, submitPlan, upsertPlanCategory,
} from './equipmentPlans';

beforeEach(() => {
  h.from.mockClear(); h.rpc.mockClear();
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) h.calls[k].length = 0;
  h.results.length = 0;
});

describe('equipment plan IO (#2700)', () => {
  it('settings default to off/spend_approvers/no self-approval when the org has none', async () => {
    h.push({ data: null, error: null });
    await expect(getPlanSettings()).resolves.toEqual({ enabled: false, approvalStep: 'spend_approvers', allowSelfApproval: false });
    h.push({ data: [{ enabled: true, approval_step: 'senior_role', allow_self_approval: true }], error: null });
    await expect(getPlanSettings()).resolves.toEqual({ enabled: true, approvalStep: 'senior_role', allowSelfApproval: true });
  });

  it('settings are written only through the RPC with all three values', async () => {
    h.push({ data: null, error: null });
    await setPlanSettings({ enabled: true, approvalStep: 'senior_role', allowSelfApproval: false });
    expect(h.calls.rpc).toEqual([['set_equipment_plan_settings', { p_enabled: true, p_approval_step: 'senior_role', p_allow_self_approval: false }]]);
  });

  it('categories list in their own order and map name_id; writes go through their RPCs', async () => {
    h.push({ data: [{ id: 'c1', name: 'Crane', name_id: 'n1', position: 2, active: true }], error: null });
    await expect(listPlanCategories()).resolves.toEqual([{ id: 'c1', name: 'Crane', nameId: 'n1', position: 2, active: true }]);
    expect(h.calls.from).toEqual(['equipment_plan_categories']);
    expect(h.calls.order).toContainEqual(['position', { ascending: true }]);
    expect(h.calls.limit).toContainEqual(200);
    h.push({ data: null, error: null });
    await upsertPlanCategory({ id: null, name: 'Scaffolding', nameId: 'Scaffolding', position: 3 });
    expect(h.calls.rpc.at(-1)).toEqual(['upsert_equipment_plan_category', { p_id: null, p_name: 'Scaffolding', p_name_id: 'Scaffolding', p_position: 3 }]);
    h.push({ data: null, error: null });
    await setPlanCategoryActive('c1', false);
    expect(h.calls.rpc.at(-1)).toEqual(['set_equipment_plan_category_active', { p_id: 'c1', p_active: false }]);
  });

  it('listPlansForMonth maps each plan with its lines sorted by date then id, and numbers the figures', async () => {
    h.push({
      data: [{
        id: 'p1', project_id: 'prj', plan_month: '2026-03-01', status: 'Submitted', created_by: 'u1', reject_reason: null,
        equipment_plan_lines: [
          { id: 'l2', work_order_id: null, category_id: 'c1', description: 'B', quantity: '1.5', rate: 200, vendor_id: 'v1', date_from: '2026-03-05', date_to: '2026-03-20', procurement_id: null },
          { id: 'l1', work_order_id: 'w1', category_id: 'c2', description: 'A', quantity: 2, rate: '1000.00', vendor_id: 'v2', date_from: '2026-03-01', date_to: '2026-03-10', procurement_id: 'po1' },
        ],
      }],
      error: null,
    });
    const plans = await listPlansForMonth('2026-03-01');
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ id: 'p1', projectId: 'prj', planMonth: '2026-03-01', status: 'Submitted', createdBy: 'u1' });
    expect(plans[0].lines.map((l) => l.id)).toEqual(['l1', 'l2']); // by date_from, then id
    expect(plans[0].lines[0]).toMatchObject({ quantity: 2, rate: 1000, dateFrom: '2026-03-01' });
    expect(h.calls.eq).toContainEqual(['plan_month', '2026-03-01']);
    expect(h.calls.limit).toContainEqual(200);
  });

  it('save sends lines in the database argument shape with client-generated ids', async () => {
    h.push({ data: { id: 'plan1' }, error: null });
    await expect(savePlan({
      id: 'plan1', projectId: 'prj', month: '2026-03-01',
      lines: [{ id: 'l1', workOrderId: 'w1', categoryId: 'c1', description: 'Crane', quantity: 2, rate: 1000, vendorId: 'v1', dateFrom: '2026-03-01', dateTo: '2026-03-05' }],
    })).resolves.toBe('plan1');
    expect(h.calls.rpc).toEqual([['save_equipment_plan', {
      p_id: 'plan1', p_project: 'prj', p_month: '2026-03-01',
      p_lines: [{ id: 'l1', work_order_id: 'w1', category_id: 'c1', description: 'Crane', quantity: 2, rate: 1000, vendor_id: 'v1', date_from: '2026-03-01', date_to: '2026-03-05' }],
    }]]);
    expect(JSON.stringify(h.calls)).not.toContain('org_id');
  });

  it('submit, reopen and approve go one-RPC-per-state with just the id; reject carries the reason', async () => {
    h.push({ data: null, error: null });
    await submitPlan('p1');
    expect(h.calls.rpc.at(-1)).toEqual(['submit_equipment_plan', { p_id: 'p1' }]);
    h.push({ data: null, error: null });
    await reopenPlan('p1');
    expect(h.calls.rpc.at(-1)).toEqual(['reopen_equipment_plan', { p_id: 'p1' }]);
    h.push({ data: null, error: null });
    await approvePlan('p1');
    expect(h.calls.rpc.at(-1)).toEqual(['approve_equipment_plan', { p_id: 'p1' }]);
    h.push({ data: null, error: null });
    await rejectPlan('p1', 'wrong month');
    expect(h.calls.rpc.at(-1)).toEqual(['reject_equipment_plan', { p_id: 'p1', p_reason: 'wrong month' }]);
  });

  it('canApprovePlan is the UX ask only: true exactly when the RPC says true', async () => {
    h.push({ data: true, error: null });
    await expect(canApprovePlan('p1')).resolves.toBe(true);
    h.push({ data: false, error: null });
    await expect(canApprovePlan('p1')).resolves.toBe(false);
    h.push({ data: null, error: { message: 'EQP_NOT_APPROVER: not on the route', code: 'P0001' } });
    await expect(canApprovePlan('p1')).rejects.toMatchObject({ message: expect.stringContaining('EQP_NOT_APPROVER') });
  });

  it('AC-EQP-008 the route read maps the people and their own roles, and keeps an honest empty', async () => {
    h.push({
      data: { approvers: [{ id: 'u1', name: 'Ani', role: 'Finance' }, { id: 'u2', name: 'Budi', role: 'Project Manager' }], route_kind: 'project' },
      error: null,
    });
    await expect(getPlanApprovalRoute('p1')).resolves.toEqual({
      kind: 'project',
      approvers: [{ id: 'u1', name: 'Ani', role: 'Finance' }, { id: 'u2', name: 'Budi', role: 'Project Manager' }],
    });
    expect(h.calls.rpc.at(-1)).toEqual(['get_equipment_plan_approval_route', { p_plan_id: 'p1' }]);
    // configured route with nobody reachable (only the author, everybody inactive) is an empty list, not a fabricated person
    h.push({ data: { approvers: [], route_kind: 'project' }, error: null });
    await expect(getPlanApprovalRoute('p1')).resolves.toEqual({ kind: 'project', approvers: [] });
    h.push({ data: { approvers: [], route_kind: 'unavailable' }, error: null });
    await expect(getPlanApprovalRoute('p1')).resolves.toEqual({ kind: 'unavailable', approvers: [] });
    h.push({ data: { approvers: [], route_kind: 'not_waiting' }, error: null });
    await expect(getPlanApprovalRoute('p1')).resolves.toEqual({ kind: 'not_waiting', approvers: [] });
  });

  it('AC-EQP-008 a malformed route body is an error, never an empty list that reads as "nobody approves"', async () => {
    for (const bad of [
      null,
      [],
      { approvers: [] },
      { approvers: [], route_kind: 'nonsense' },
      { approvers: 'x', route_kind: 'project' },
      { approvers: [{ id: 'u1', role: 'Finance' }], route_kind: 'project' },
      { approvers: [{ id: 'u1', name: '   ', role: 'Finance' }], route_kind: 'project' },
      { approvers: [{ id: '', name: 'Ani', role: 'Finance' }], route_kind: 'project' },
      { approvers: [{ id: 'u1', name: 'Ani', role: 'Owner' }], route_kind: 'project' },
      { approvers: [{ id: 'u1', name: 'Ani', role: 'Finance' }], route_kind: null },
    ]) {
      expect(() => parsePlanApprovalRoute(bad)).toThrowError(/malformed/i);
    }
    h.push({ data: { approvers: 'x', route_kind: 'project' }, error: null });
    await expect(getPlanApprovalRoute('p1')).rejects.toMatchObject({ code: 'plan-route-malformed' });
    h.push({ data: null, error: { message: 'LIGHT_ACCOUNT: this account has one phone home screen and cannot read this', code: '42501' } });
    await expect(getPlanApprovalRoute('p1')).rejects.toMatchObject({ code: '42501' });
  });
});
