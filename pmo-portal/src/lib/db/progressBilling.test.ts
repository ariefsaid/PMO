import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const result = { data: null as unknown, error: null as unknown };
  for (const name of ['select', 'insert', 'update', 'delete', 'eq', 'order', 'single']) chain[name] = vi.fn(() => chain);
  const thenable = { ...chain, then: (resolve: (v: unknown) => unknown) => resolve(result) };
  for (const name of Object.keys(chain)) chain[name].mockImplementation(() => thenable);
  return { rpc: vi.fn(), from: vi.fn(() => thenable), chain, result };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, from: h.from } }));
import {
  attachClaimEvidence, createBoqItem, createProgressClaim, getProjectBilling, listBoqItems, recordProgressAssessment, updateBoqItem,
} from './progressBilling';

const CONTRACT = {
  earning_basis: 'unit_rate', line_no: 1, ordered_quantity: '1000.000', accepted_quantity: '997.000', closed_final: '997.000',
  earned_quantity: '997.000', contract_balance: '903.000',
  allocations: [
    { work_order_id: 'wo-1', boq_item_id: 'b1', quantity: '1000.000', claimed_quantity: '0.000', accepted_quantity: null, final: false },
    { work_order_id: 'wo-2', boq_item_id: 'b1', quantity: 5, claimed_quantity: 2, accepted_quantity: 0, final: true },
  ],
};
const summary = (over: Record<string, unknown> = {}, line: Record<string, unknown> = {}) => ({
  data: { currency: 'IDR', contract_net: 1, work_billed: 0, dp_billed: 0, dp_recovered: 0, not_submitted: 0, assessment: null, earned_value: 0,
    boq: [{ boq_item_id: 'b1', claimed_quantity: 0, assessed_quantity: null, ...CONTRACT, ...line }], ...over }, error: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.result.data = null; h.result.error = null;
});

describe('progress billing DAL', () => {
  it('AC-PB-008 maps the billing summary, with the latest assessment and per-line quantities', async () => {
    h.rpc.mockResolvedValue({ data: {
      currency: 'IDR', contract_net: '1000000.00', work_billed: 200000, dp_billed: 200000, dp_recovered: 40000, not_submitted: 40000,
      assessment: { month: '2026-10-01', pct_complete: '60.00' },
      earned_value: '0.00',
      boq: [{ boq_item_id: 'b1', claimed_quantity: '5.000', assessed_quantity: '6.000', ...CONTRACT }, { boq_item_id: 'b2', claimed_quantity: 0, assessed_quantity: null, ...CONTRACT, line_no: null, allocations: [] }],
    }, error: null });
    expect(await getProjectBilling('p1')).toEqual({
      currency: 'IDR', contractNet: 1_000_000, workBilled: 200_000, dpBilled: 200_000, dpRecovered: 40_000, notSubmitted: 40_000,
      assessment: { month: '2026-10-01', pctComplete: 60 },
      claimedByBoqItem: { b1: 5, b2: 0 }, assessedByBoqItem: { b1: 6 },
      earnedValue: 0,
      contractLines: [
        { boqItemId: 'b1', earningBasis: 'unit_rate', lineNo: 1, orderedQuantity: 1000, acceptedQuantity: 997, closedFinal: 997, earnedQuantity: 997, contractBalance: 903,
          allocations: [{ workOrderId: 'wo-1', boqItemId: 'b1', quantity: 1000, claimedQuantity: 0, acceptedQuantity: null, final: false }, { workOrderId: 'wo-2', boqItemId: 'b1', quantity: 5, claimedQuantity: 2, acceptedQuantity: 0, final: true }] },
        { boqItemId: 'b2', earningBasis: 'unit_rate', lineNo: null, orderedQuantity: 1000, acceptedQuantity: 997, closedFinal: 997, earnedQuantity: 997, contractBalance: 903, allocations: [] },
      ],
    });
    expect(h.rpc).toHaveBeenCalledWith('get_project_billing', { p_project_id: 'p1' });
  });

  it('AC-PB-008 no assessment maps to null, never 0%', async () => {
    h.rpc.mockResolvedValue({ data: { currency: 'IDR', contract_net: 1, work_billed: 0, dp_billed: 0, dp_recovered: 0, not_submitted: 0, assessment: null, earned_value: 0, boq: [] }, error: null });
    expect((await getProjectBilling('p1'))?.assessment).toBeNull();
  });

  it('AC-PB-008 an invisible project is null, never a zero summary', async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    expect(await getProjectBilling('p1')).toBeNull();
  });

  it('AC-PB-008 a malformed summary is an error, never a fabricated figure', async () => {
    h.rpc.mockResolvedValue({ data: { currency: 'IDR', contract_net: 1, dp_billed: 0, dp_recovered: 0, not_submitted: 0, assessment: null, boq: [] }, error: null });
    await expect(getProjectBilling('p1')).rejects.toMatchObject({ code: 'billing-malformed' });
  });

  it('AC-PB-009 a billing claim sends quantities and scope, never money', async () => {
    h.rpc.mockResolvedValue({ data: 'claim-1', error: null });
    expect(await createProgressClaim({ projectId: 'p1', kind: 'progress', workOrderId: 'wo-1', lines: [{ boqItemId: 'b1', quantity: 4 }], recoverRemaining: true })).toBe('claim-1');
    expect(h.rpc).toHaveBeenCalledWith('create_progress_claim', { p_project_id: 'p1', p_kind: 'progress', p_work_order_id: 'wo-1', p_lines: [{ boq_item_id: 'b1', quantity: 4 }], p_recover_remaining: true });
  });

  it('AC-PB-009 a down payment claim sends amount and percentage only, and no work order when none is chosen', async () => {
    h.rpc.mockResolvedValue({ data: 'claim-2', error: null });
    await createProgressClaim({ projectId: 'p1', kind: 'down_payment', workOrderId: null, downPaymentAmount: 200000, recoveryPct: 20 });
    expect(h.rpc).toHaveBeenCalledWith('create_progress_claim', { p_project_id: 'p1', p_kind: 'down_payment', p_down_payment_amount: 200000, p_recovery_pct: 20 });
  });

  it('AC-PB-019 an assessment sends every line and the month, and returns the derived percent', async () => {
    h.rpc.mockResolvedValue({ data: '40.00', error: null });
    expect(await recordProgressAssessment({ projectId: 'p1', month: '2026-09-01', quantities: [{ boqItemId: 'b1', quantityToDate: 6 }, { boqItemId: 'b2', quantityToDate: 0 }], note: null })).toBe(40);
    expect(h.rpc).toHaveBeenCalledWith('record_progress_assessment', { p_project_id: 'p1', p_month: '2026-09-01', p_quantities: [{ boq_item_id: 'b1', quantity_to_date: 6 }, { boq_item_id: 'b2', quantity_to_date: 0 }] });
  });

  it('AC-PB-020 attaching evidence names the claim and the document', async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    await attachClaimEvidence('claim-1', 'doc-1');
    expect(h.rpc).toHaveBeenCalledWith('attach_claim_evidence', { p_claim_id: 'claim-1', p_document_id: 'doc-1' });
  });

  it('AC-CQ-012 an allocation accepted quantity of null (no BAST) stays distinct from 0 (a BAST of zero)', async () => {
    h.rpc.mockResolvedValue(summary());
    const [first, second] = (await getProjectBilling('p1'))!.contractLines[0].allocations;
    expect(first.acceptedQuantity).toBeNull();
    expect(second.acceptedQuantity).toBe(0);
  });

  it.each([
    ['missing earned_value', { earned_value: undefined }, {}],
    ['null earned_value', { earned_value: null }, {}],
    ['NaN earned_value', { earned_value: 'x' }, {}],
    ['unknown earning_basis', {}, { earning_basis: 'weird' }],
    ['null earned_quantity', {}, { earned_quantity: null }],
    ['missing ordered_quantity', {}, { ordered_quantity: undefined }],
    ['non-finite contract_balance', {}, { contract_balance: 'Infinity' }],
    ['non-array allocations', {}, { allocations: null }],
    ['allocation without work_order_id', {}, { allocations: [{ boq_item_id: 'b1', quantity: 1, claimed_quantity: 0, accepted_quantity: null, final: false }] }],
    ['allocation with missing accepted_quantity key', {}, { allocations: [{ work_order_id: 'w', boq_item_id: 'b1', quantity: 1, claimed_quantity: 0, final: false }] }],
    ['allocation with null claimed_quantity', {}, { allocations: [{ work_order_id: 'w', boq_item_id: 'b1', quantity: 1, claimed_quantity: null, accepted_quantity: null, final: false }] }],
    ['allocation with non-boolean final', {}, { allocations: [{ work_order_id: 'w', boq_item_id: 'b1', quantity: 1, claimed_quantity: 0, accepted_quantity: null, final: 'yes' }] }],
  ])('AC-CQ-012 a malformed payload (%s) is an error, never a zero', async (_name, over, line) => {
    h.rpc.mockResolvedValue(summary(over, line));
    await expect(getProjectBilling('p1')).rejects.toMatchObject({ code: 'billing-malformed' });
  });

  it('AC-CQ-001 a BoQ insert sends basis and line number and no work order or org', async () => {
    h.result.data = { id: 'b1' };
    await createBoqItem('p1', { itemCode: 'A-1', description: 'Cable', unit: 'km', quantity: 1900, rate: 50, earningBasis: 'unit_rate', lineNo: 3 });
    expect(h.from).toHaveBeenCalledWith('boq_items');
    expect(h.chain.insert).toHaveBeenCalledWith({
      project_id: 'p1', item_code: 'A-1', description: 'Cable', unit: 'km', quantity: 1900, rate: 50, earning_basis: 'unit_rate', line_no: 3,
    });
  });

  it('AC-CQ-001 a BoQ update sends basis and line number, not import_key or work order', async () => {
    h.result.data = [{ id: 'b1' }];
    await updateBoqItem('b1', { itemCode: 'A-1', description: 'Cable', unit: 'lot', quantity: 1, rate: 50, earningBasis: 'lump_sum', lineNo: null });
    expect(h.chain.update).toHaveBeenCalledWith({
      item_code: 'A-1', description: 'Cable', unit: 'lot', quantity: 1, rate: 50, earning_basis: 'lump_sum', line_no: null,
    });
  });

  it('AC-CQ-012 the BoQ list is ordered by line number (nulls last), then created_at, then id', async () => {
    h.result.data = [];
    await listBoqItems('p1');
    expect(h.chain.order.mock.calls).toEqual([
      ['line_no', { ascending: true, nullsFirst: false }],
      ['created_at', { ascending: true }],
      ['id', { ascending: true }],
    ]);
  });
});
