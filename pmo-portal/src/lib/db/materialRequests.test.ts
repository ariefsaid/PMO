import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '@/src/lib/appError';

/**
 * Material requests DAL + repository (#2524, migrations 1000/1001). The database decides every rule (order, SoD,
 * stand-in window, over-plan reason, cut-off); this module carries requests, never sends org_id, keeps each refusal's
 * Postgres code, and owns the two pure helpers the screen needs: the per-line plan status (AC-MRQ-001 unit half)
 * and the "waiting for me" ordering (AC-MRQ-013 unit half).
 */
const h = vi.hoisted(() => {
  const result = { value: {} as { data: unknown; error: unknown } };
  const calls = {
    from: [] as string[], rpc: [] as Array<[string, unknown]>, select: [] as unknown[], eq: [] as unknown[], in: [] as unknown[],
    gte: [] as unknown[], lte: [] as unknown[], order: [] as unknown[], lt: [] as unknown[], or: [] as unknown[], limit: [] as unknown[],
  };
  const builder: Record<string, unknown> = {};
  const chain = (name: keyof typeof calls) => (...a: unknown[]) => { (calls[name] as unknown[]).push(a.length === 1 ? a[0] : a); return builder; };
  for (const k of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'lt', 'or', 'limit'] as const) builder[k] = chain(k);
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const from = vi.fn((t: string) => { calls.from.push(t); return builder; });
  const rpc = vi.fn((n: string, a?: unknown) => { calls.rpc.push([n, a]); return Promise.resolve(result.value); });
  return { from, rpc, calls, result };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import * as dal from './materialRequests';
import { materialRequestRepository } from '@/src/lib/repositories/materialRequests';

beforeEach(() => {
  h.from.mockClear(); h.rpc.mockClear();
  for (const v of Object.values(h.calls)) (v as unknown[]).length = 0;
  h.result.value = { data: null, error: null };
});

describe('AC-MRQ-001 line plan status (unit half)', () => {
  it('AC-MRQ-001 a line within plan needs no reason', () => {
    expect(dal.linePlanStatus({ planQty: 100, priorQty: 50, quantity: 50 })).toEqual({ newTotal: 100, overPlan: false });
  });
  it('AC-MRQ-001 a line whose new total exceeds plan is over plan', () => {
    expect(dal.linePlanStatus({ planQty: 100, priorQty: 50, quantity: 60 })).toEqual({ newTotal: 110, overPlan: true });
  });
  it('AC-MRQ-001 decimal quantities do not drift (exact to 3 places)', () => {
    expect(dal.linePlanStatus({ planQty: 0.3, priorQty: 0.1, quantity: 0.2 })).toEqual({ newTotal: 0.3, overPlan: false });
  });
  it('AC-MRQ-001 the form flags an over-plan line with a blank reason, and only that line', () => {
    const errors = dal.draftLineErrors([
      { itemId: 'i1', quantity: 60, overPlanReason: '  ', planQty: 100, priorQty: 50 },
      { itemId: 'i2', quantity: 10, overPlanReason: '', planQty: 100, priorQty: 0 },
      { itemId: 'i3', quantity: 0, overPlanReason: '', planQty: 100, priorQty: 0 },
      { itemId: 'i4', quantity: 5, overPlanReason: 'x'.repeat(501), planQty: 0, priorQty: 0 },
    ]);
    expect(errors).toEqual({ 0: 'reasonRequired', 2: 'quantityRequired', 3: 'reasonTooLong' });
  });
  it('AC-MRQ-001 with the reason filled the over-plan line is accepted', () => {
    expect(dal.draftLineErrors([{ itemId: 'i1', quantity: 60, overPlanReason: 'second pour', planQty: 100, priorQty: 50 }])).toEqual({});
  });
});

describe('AC-MRQ-013 waiting for me (unit half)', () => {
  it('AC-MRQ-013 maps the queue and orders it oldest first, keeping who a stand-in acts for', async () => {
    h.result.value = {
      data: [
        { request_id: 'r2', step_position: 2, role: 'Project Manager', label: 'Billable change', acting_for: 'pm1', submitted_at: '2026-11-19T03:00:00Z' },
        { request_id: 'r1', step_position: 1, role: 'Engineer', label: 'Plan check', acting_for: null, submitted_at: '2026-11-18T03:00:00Z' },
      ],
      error: null,
    };
    await expect(materialRequestRepository.waitingForMe()).resolves.toEqual([
      { requestId: 'r1', stepPosition: 1, role: 'Engineer', label: 'Plan check', actingFor: null, submittedAt: '2026-11-18T03:00:00Z' },
      { requestId: 'r2', stepPosition: 2, role: 'Project Manager', label: 'Billable change', actingFor: 'pm1', submittedAt: '2026-11-19T03:00:00Z' },
    ]);
    expect(h.calls.rpc).toEqual([['mrq_waiting_for_me', undefined]]);
  });
});

describe('material request writes', () => {
  it('FR-MRQ-001 saveDraft sends the header and lines and a client request id — never org_id', async () => {
    h.result.value = { data: 'mr1', error: null };
    await expect(dal.saveMaterialRequestDraft(null, {
      workOrderId: 'wo1', neededBy: '2026-11-25', toWarehouseId: null, note: 'gate 2',
    }, [{ itemId: 'i1', quantity: 12, overPlanReason: null }], 'c1')).resolves.toBe('mr1');
    expect(h.calls.rpc).toEqual([['mrq_save_draft', {
      p_request_id: null,
      p_header: { work_order_id: 'wo1', needed_by: '2026-11-25', to_warehouse_id: null, note: 'gate 2' },
      p_lines: [{ item_id: 'i1', quantity: 12, over_plan_reason: null }],
      p_client_request_id: 'c1',
    }]]);
  });
  it('FR-MRQ-004 submit carries its own client request id', async () => {
    await dal.submitMaterialRequest('mr1', 'c2');
    expect(h.calls.rpc).toEqual([['mrq_submit', { p_request_id: 'mr1', p_client_request_id: 'c2' }]]);
  });
  it('FR-MRQ-008 decideStep names the step it acts on, the decision, reason and source warehouse', async () => {
    await dal.decideMaterialRequestStep('mr1', 3, 'approve', { sourceWarehouseId: 'wh1' });
    await dal.decideMaterialRequestStep('mr1', 2, 'return', { reason: 'split it' });
    expect(h.calls.rpc).toEqual([
      ['mrq_decide_step', { p_request_id: 'mr1', p_step_position: 3, p_decision: 'approve', p_reason: null, p_source_warehouse_id: 'wh1' }],
      ['mrq_decide_step', { p_request_id: 'mr1', p_step_position: 2, p_decision: 'return', p_reason: 'split it', p_source_warehouse_id: null }],
    ]);
  });
  it('AC-MRQ-003 a database refusal keeps its code so the screen can explain it', async () => {
    h.result.value = { data: null, error: { message: 'MRQ_SOD_AUTHOR: you cannot decide a request you raised', code: '42501' } };
    const err = await materialRequestRepository.decideStep('mr1', 1, 'approve').catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('42501');
    expect(dal.materialRequestRefusal(err)).toBe('sodAuthor');
  });
  it('FR-MRQ-005/009/014 configuration calls map their arguments', async () => {
    await dal.setApprovalChain([{ role: 'Engineer', label: 'Plan check', onlyOverPlan: true }]);
    await dal.setMaterialRequestCutoff('12:00');
    h.result.value = { data: 's1', error: null };
    await dal.setStandIn({ delegatorId: 'u1', standInId: 'u2', startsOn: '2026-11-20', endsOn: '2026-11-27' });
    expect(h.calls.rpc).toEqual([
      ['mrq_set_chain', { p_steps: [{ role: 'Engineer', label: 'Plan check', only_over_plan: true }] }],
      ['mrq_set_cutoff', { p_cutoff: '12:00' }],
      ['mrq_set_stand_in', { p_delegator_id: 'u1', p_stand_in_id: 'u2', p_starts_on: '2026-11-20', p_ends_on: '2026-11-27' }],
    ]);
  });
});

describe('FR-MRQ-019 list', () => {
  it('FR-MRQ-019 filters by work order, status and needed-by range in a stable, bounded order', async () => {
    h.result.value = { data: [], error: null };
    await dal.listMaterialRequests({ workOrderId: 'wo1', statuses: ['pending', 'approved'], neededFrom: '2026-11-20', neededTo: '2026-11-30' });
    expect(h.calls.from).toEqual(['material_requests']);
    expect(h.calls.eq).toEqual([['work_order_id', 'wo1']]);
    expect(h.calls.in).toEqual([['status', ['pending', 'approved']]]);
    expect(h.calls.gte).toEqual([['needed_by', '2026-11-20']]);
    expect(h.calls.lte).toEqual([['needed_by', '2026-11-30']]);
    expect(h.calls.order).toEqual([['created_at', { ascending: false }], ['id', { ascending: false }]]);
    expect(h.calls.limit).toEqual([51]);
  });
  it('FR-MRQ-019 a full page reports a cursor for the next one', async () => {
    const rows = Array.from({ length: 51 }, (_, i) => ({ id: `r${i}`, created_at: `2026-11-${String(30 - (i % 28)).padStart(2, '0')}T00:00:00Z` }));
    h.result.value = { data: rows, error: null };
    const page = await dal.listMaterialRequests({});
    expect(page.rows).toHaveLength(50);
    expect(page.nextCursor).toEqual({ createdAt: rows[49].created_at, id: 'r49' });
  });
});
