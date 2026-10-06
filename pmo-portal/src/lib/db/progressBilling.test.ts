import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));
import { attachClaimEvidence, createProgressClaim, getProjectBilling, recordProgressAssessment } from './progressBilling';

beforeEach(() => vi.clearAllMocks());

describe('progress billing DAL', () => {
  it('AC-PB-008 maps the billing summary, with the latest assessment and per-line quantities', async () => {
    h.rpc.mockResolvedValue({ data: {
      currency: 'IDR', contract_net: '1000000.00', work_billed: 200000, dp_billed: 200000, dp_recovered: 40000, not_submitted: 40000,
      assessment: { month: '2026-10-01', pct_complete: '60.00' },
      boq: [{ boq_item_id: 'b1', claimed_quantity: '5.000', assessed_quantity: '6.000' }, { boq_item_id: 'b2', claimed_quantity: 0, assessed_quantity: null }],
    }, error: null });
    expect(await getProjectBilling('p1')).toEqual({
      currency: 'IDR', contractNet: 1_000_000, workBilled: 200_000, dpBilled: 200_000, dpRecovered: 40_000, notSubmitted: 40_000,
      assessment: { month: '2026-10-01', pctComplete: 60 },
      claimedByBoqItem: { b1: 5, b2: 0 }, assessedByBoqItem: { b1: 6 },
    });
    expect(h.rpc).toHaveBeenCalledWith('get_project_billing', { p_project_id: 'p1' });
  });

  it('AC-PB-008 no assessment maps to null, never 0%', async () => {
    h.rpc.mockResolvedValue({ data: { currency: 'IDR', contract_net: 1, work_billed: 0, dp_billed: 0, dp_recovered: 0, not_submitted: 0, assessment: null, boq: [] }, error: null });
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
});
