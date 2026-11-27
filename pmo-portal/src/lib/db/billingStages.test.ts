import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const results: Record<string, { data: unknown; error: unknown }> = {};
  const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    let start = 0; let end: number | undefined;
    for (const op of ['select', 'eq', 'order', 'limit', 'range', 'maybeSingle']) {
      b[op] = (...args: unknown[]) => { calls.push({ table, op, args }); if (op === 'limit') end = Number(args[0]); if (op === 'range') { start = Number(args[0]); end = Number(args[1]) + 1; } return b; };
    }
    b.then = (resolve: (v: unknown) => unknown) => { const result = results[table] ?? { data: [], error: null }; return resolve({ ...result, data: Array.isArray(result.data) ? result.data.slice(start, end) : result.data }); };
    return b;
  };
  const rpc = vi.fn();
  return { results, calls, from: vi.fn((t: string) => builder(t)), rpc };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import {
  completeBillingStage, getClaimBillingTrace, getBillingReconciliation, listRetentionReleases, scheduleRetentionRelease, setBillingStageTemplate,
} from './billingStages';
import { AppError } from '@/src/lib/appError';

beforeEach(() => { h.rpc.mockReset(); h.calls.length = 0; for (const k of Object.keys(h.results)) delete h.results[k]; });

describe('billing stages DAL', () => {
  it('saves all project terms in one request', async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    const dal = await import('./billingStages');
    await dal.setProjectBillingTerms('p1', [{ name: 'Stage', clientSide: false, documents: [] }], 25, 5, 2.5);
    expect(h.rpc).toHaveBeenCalledOnce();
    expect(h.rpc).toHaveBeenCalledWith('set_project_billing_terms', { p_project: 'p1', p_stages: [{ name: 'Stage', client_side: false, documents: [] }], p_day: 25, p_warn_days: 5, p_pct: 2.5 });
  });

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

  it('lists every retention release across multiple pages', async () => {
    h.results.retention_releases = { data: Array.from({ length: 1001 }, (_, i) => ({ id: String(i), amount: 1, due_on: '2026-01-01', note: null, released_on: null, reference_no: null, document_id: null })), error: null };
    expect(await listRetentionReleases('c1')).toHaveLength(1001);
  });

  it('AC-RET-002 scheduling returns the release id and names the over-release refusal', async () => {
    h.rpc.mockResolvedValueOnce({ data: 'r1', error: null });
    expect(await scheduleRetentionRelease({ claimId: 'c1', amount: 25000, dueOn: '2026-06-01', note: null })).toBe('r1');
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'x', code: '23514', details: 'retention-exceeded' } });
    await expect(scheduleRetentionRelease({ claimId: 'c1', amount: 1, dueOn: '2026-06-01', note: null }))
      .rejects.toMatchObject({ code: 'retention-exceeded' });
  });
});

describe('billing stage targets and optional stages DAL (#2592)', () => {
  it('AC-BSX-001 the list is sent with each stage\'s target and optional flag, and an unset figure is not invented', async () => {
    h.rpc.mockResolvedValue({ data: 2, error: null });
    await setBillingStageTemplate('p1', [
      { name: 'Measure', clientSide: false, targetDays: 10, optional: false, documents: [] },
      { name: 'Review', clientSide: false, targetDays: null, optional: true, documents: [] },
    ]);
    expect(h.rpc).toHaveBeenCalledWith('set_billing_stage_template', { p_project: 'p1', p_stages: [
      { name: 'Measure', client_side: false, target_days: 10, documents: [] },
      { name: 'Review', client_side: false, optional: true, documents: [] },
    ] });
  });

  it('AC-BSX-007 marking a stage not needed sends the reason; a database refusal becomes the code the screen explains', async () => {
    const dal = await import('./billingStages');
    h.rpc.mockResolvedValue({ data: null, error: null });
    await dal.skipBillingStage('s2', 'Not needed here');
    expect(h.rpc).toHaveBeenCalledWith('skip_billing_stage', { p_stage: 's2', p_reason: 'Not needed here' });
    h.rpc.mockResolvedValue({ data: null, error: { message: 'cannot', code: '55000', details: 'stage-not-skippable' } });
    const err = await dal.skipBillingStage('s1', 'Not needed here').catch((e) => e);
    expect((err as AppError).code).toBe('stage-not-skippable');
  });

  it('AC-BSX-012 the trace carries each stage\'s target, optional flag and skip', async () => {
    h.results.claim_billing_stages = { data: [
      { id: 's1', position: 1, name: 'Review', client_side: false, target_days: 5, optional: true, started_on: '2026-03-01', completed_on: null,
        skipped_on: '2026-03-03', skipped_reason: 'Not needed here', client_reference: null, note: null, documents: [] },
    ], error: null };
    h.results.claim_retention = { data: null, error: null };
    h.results.projects = { data: null, error: null };
    const trace = await getClaimBillingTrace('c1', 'p1');
    expect(trace.stages[0]).toMatchObject({ targetDays: 5, optional: true, skippedOn: '2026-03-03', skippedReason: 'Not needed here' });
  });
});

it('AC-READ-002 maps every reconciliation page including tied and null keys', async () => {
 const fixture = Array.from({ length: 2002 }, (_, i) => ({ boq_item_id: String(i), item_code: i < 1001 ? 'same' : null, line_no: null, status: 'unbilled' }));
 h.rpc.mockReturnValue({ range: (from: number, to: number) => Promise.resolve({ data: fixture.slice(from, to + 1), error: null }) });
 const rows = await getBillingReconciliation('p1', null);
 expect(rows.map(r => r.boqItemId)).toEqual(fixture.map(r => r.boq_item_id));
 expect(new Set(rows.map(r => r.boqItemId)).size).toBe(2002);
});
