import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const results: Record<string, { data: unknown; error: unknown }> = {};
  const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const op of ['select', 'eq', 'order', 'limit', 'range', 'maybeSingle']) {
      b[op] = (...args: unknown[]) => { calls.push({ table, op, args }); return b; };
    }
    b.then = (resolve: (v: unknown) => unknown) => resolve(results[table] ?? { data: [], error: null });
    return b;
  };
  const rpc = vi.fn();
  return { results, calls, from: vi.fn((t: string) => builder(t)), rpc };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import {
  completeBillingStage, getClaimBillingTrace, getBillingReconciliation, scheduleRetentionRelease, setBillingStageTemplate,
} from './billingStages';
import { AppError } from '@/src/lib/appError';

beforeEach(() => { h.rpc.mockReset(); h.calls.length = 0; for (const k of Object.keys(h.results)) delete h.results[k]; });

describe('billing stages DAL', () => {
  it('AC-BST-004 a refusal detail from the database becomes the error code the screen explains', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'complete the earlier billing stages first', code: '55000', details: 'stage-out-of-order' } });
    const err = await completeBillingStage({ stageId: 's2', completedOn: '2026-03-02', clientReference: 'JS-1', note: null }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('stage-out-of-order');
    expect(h.rpc).toHaveBeenCalledWith('complete_billing_stage',
      { p_stage: 's2', p_completed_on: '2026-03-02', p_client_reference: 'JS-1', p_note: null });
  });

  it('AC-BST-002 the stage list is sent whole, in order, with each checklist', async () => {
    h.rpc.mockResolvedValue({ data: 2, error: null });
    await setBillingStageTemplate('p1', [
      { name: 'Internal measurement', clientSide: false, documents: [{ name: 'Sheet', required: true }] },
      { name: 'Client approval', clientSide: true, documents: [] },
    ]);
    expect(h.rpc).toHaveBeenCalledWith('set_billing_stage_template', { p_project: 'p1', p_stages: [
      { name: 'Internal measurement', client_side: false, documents: [{ name: 'Sheet', required: true }] },
      { name: 'Client approval', client_side: true, documents: [] },
    ] });
  });

  it('AC-TRACE-001 the trace orders stages and their checklists by position and carries retention and the deadline', async () => {
    h.results.claim_billing_stages = { data: [
      { id: 's2', position: 2, name: 'Approval', client_side: true, started_on: null, completed_on: null, client_reference: null, note: null,
        documents: [{ id: 'd3', position: 1, name: 'Letter', required: true, document_id: null }] },
      { id: 's1', position: 1, name: 'Measure', client_side: false, started_on: '2026-03-01', completed_on: '2026-03-04', client_reference: null, note: null,
        documents: [{ id: 'd2', position: 2, name: 'Photos', required: false, document_id: null }, { id: 'd1', position: 1, name: 'Sheet', required: true, document_id: 'doc-1' }] },
    ], error: null };
    h.results.claim_retention = { data: { retention_pct: 5, retention_amount: 50000, scheduled: 25000, released: 0, held: 50000 }, error: null };
    h.results.projects = { data: { invoice_deadline_day: 25, invoice_deadline_warn_days: 5 }, error: null };
    const trace = await getClaimBillingTrace('c1', 'p1');
    expect(trace.stages.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(trace.stages[0].documents.map((d) => d.id)).toEqual(['d1', 'd2']);
    expect(trace.stages[0]).toMatchObject({ startedOn: '2026-03-01', completedOn: '2026-03-04', clientSide: false });
    expect(trace.retention).toEqual({ pct: 5, amount: 50000, scheduled: 25000, released: 0, held: 50000 });
    expect(trace.deadline).toEqual({ day: 25, warnDays: 5 });
  });

  it('AC-BST-020 the reconciliation reads every page of the one server derivation', async () => {
    h.results.billing_reconciliation = { data: [], error: null };
    h.rpc.mockReturnValue({ range: (from: number, to: number) => {
      h.calls.push({ table: 'billing_reconciliation', op: 'range', args: [from, to] });
      return Promise.resolve({ data: [{ boq_item_id: 'b1', item_code: 'A', status: 'partly_billed', billed_amount: '400000.00' }], error: null });
    } });
    const rows = await getBillingReconciliation('p1', 'wo1');
    expect(h.rpc).toHaveBeenCalledWith('billing_reconciliation', { p_project: 'p1', p_work_order: 'wo1' });
    expect(rows).toEqual([expect.objectContaining({ itemCode: 'A', status: 'partly_billed', billedAmount: 400000 })]);
  });

  it('AC-RET-002 scheduling returns the release id and names the over-release refusal', async () => {
    h.rpc.mockResolvedValueOnce({ data: 'r1', error: null });
    expect(await scheduleRetentionRelease({ claimId: 'c1', amount: 25000, dueOn: '2026-06-01', note: null })).toBe('r1');
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'x', code: '23514', details: 'retention-exceeded' } });
    await expect(scheduleRetentionRelease({ claimId: 'c1', amount: 1, dueOn: '2026-06-01', note: null }))
      .rejects.toMatchObject({ code: 'retention-exceeded' });
  });
});
