import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const result = { data: null as unknown, error: null as unknown };
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const thenable: Record<string, unknown> = { then: (resolve: (v: unknown) => unknown) => resolve(result) };
  for (const name of ['select', 'insert', 'update', 'delete', 'eq', 'order', 'limit', 'single']) {
    chain[name] = vi.fn(() => thenable);
    thenable[name] = chain[name];
  }
  return { rpc: vi.fn(), from: vi.fn(() => thenable), chain, result };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, from: h.from } }));

import {
  getPoPosition,
  listPoRevisions,
  listPoLines,
  setPoLines,
  issuePoLines,
  listSubcontractAcceptances,
  prepareSubcontractAcceptance,
  confirmSubcontractAcceptance,
  withdrawSubcontractAcceptance,
  captureSubcontractVendorInvoice,
  listPoVariations,
  requestPoVariation,
  decidePoVariation,
  issuePoRevision,
  linkPoVariation,
  getVariationRoute,
  getProjectSubcontractExposure,
  listWorkOrderCostVariations,
  listSubcontractCapExceptions,
  attributeSubcontractBillLines,
} from './subcontracts';

beforeEach(() => {
  vi.clearAllMocks();
  h.result.data = null;
  h.result.error = null;
});

describe('subcontract DAL (src/lib/db/subcontracts.ts)', () => {
  it('FR-SCA-050 getPoPosition calls subcontract_po_position with poId and preserves nulls on billed/payable', async () => {
    const rawRows = [
      {
        boq_item_id: 'b1',
        item_code: 'L1',
        description: 'Excavation',
        unit: 'm3',
        rate: 150000,
        po_qty: 100,
        revision: 1,
        verified: 120,
        verified_not_on_po: 20,
        verified_at: '2026-10-20T00:00:00Z',
        disputed: 0,
        billed: null,
        payable: null,
      },
    ];
    h.rpc.mockResolvedValue({ data: rawRows, error: null });

    const rows = await getPoPosition('po-1');
    expect(h.rpc).toHaveBeenCalledWith('subcontract_po_position', { p_po_id: 'po-1' });
    expect(rows).toEqual(rawRows);
    expect(rows[0].billed).toBeNull();
    expect(rows[0].payable).toBeNull();
  });

  it('listPoRevisions selects from purchase_order_revisions ordered by revision', async () => {
    h.result.data = [{ id: 'rev-1', revision: 1 }];
    const res = await listPoRevisions('po-1');
    expect(h.from).toHaveBeenCalledWith('purchase_order_revisions');
    expect(h.chain.select).toHaveBeenCalledWith('*');
    expect(h.chain.eq).toHaveBeenCalledWith('po_id', 'po-1');
    expect(h.chain.order).toHaveBeenCalledWith('revision', { ascending: true });
    expect(res).toEqual([{ id: 'rev-1', revision: 1 }]);
  });

  it('listPoLines selects from purchase_order_lines with optional revision filter', async () => {
    h.result.data = [{ id: 'line-1', revision: 2 }];
    const res = await listPoLines('po-1', 2);
    expect(h.from).toHaveBeenCalledWith('purchase_order_lines');
    expect(h.chain.select).toHaveBeenCalledWith('*');
    expect(h.chain.eq).toHaveBeenCalledWith('po_id', 'po-1');
    expect(h.chain.eq).toHaveBeenCalledWith('revision', 2);
    expect(res).toEqual([{ id: 'line-1', revision: 2 }]);
  });

  it('FR-SCA-001 setPoLines calls set_subcontract_po_lines with poId and mapped lines', async () => {
    h.rpc.mockResolvedValue({ data: 2, error: null });
    const lines = [
      { boqItemId: 'b1', quantity: 100, rate: 150000, unit: 'm3' },
      { boqItemId: 'b2', quantity: 50, rate: 90000, unit: 'm' },
    ];
    const res = await setPoLines('po-1', lines);
    expect(h.rpc).toHaveBeenCalledWith('set_subcontract_po_lines', {
      p_po_id: 'po-1',
      p_lines: [
        { boq_item_id: 'b1', quantity: 100, rate: 150000, unit: 'm3' },
        { boq_item_id: 'b2', quantity: 50, rate: 90000, unit: 'm' },
      ],
    });
    expect(res).toBe(2);
  });

  it('FR-SCA-002 issuePoLines calls issue_subcontract_po_lines with poId', async () => {
    h.rpc.mockResolvedValue({ data: 1, error: null });
    const res = await issuePoLines('po-1');
    expect(h.rpc).toHaveBeenCalledWith('issue_subcontract_po_lines', { p_po_id: 'po-1' });
    expect(res).toBe(1);
  });

  it('listSubcontractAcceptances selects header + lines, newest first, limited to 200', async () => {
    h.result.data = [{ id: 'acc-1', lines: [] }];
    const res = await listSubcontractAcceptances('po-1');
    expect(h.from).toHaveBeenCalledWith('subcontract_acceptances');
    expect(h.chain.select).toHaveBeenCalledWith('*, lines:subcontract_acceptance_lines(*)');
    expect(h.chain.eq).toHaveBeenCalledWith('po_id', 'po-1');
    expect(h.chain.order).toHaveBeenCalledWith('confirmed_at', { ascending: false });
    expect(h.chain.limit).toHaveBeenCalledWith(200);
    expect(res).toEqual([{ id: 'acc-1', lines: [] }]);
  });

  it('FR-SCA-010 prepareSubcontractAcceptance calls prepare_subcontract_acceptance with named parameters', async () => {
    h.rpc.mockResolvedValue({ data: 'acc-1', error: null });
    const res = await prepareSubcontractAcceptance({
      poId: 'po-1',
      acceptanceDate: '2026-11-01',
      lines: [{ boqItemId: 'b1', quantity: 120 }],
      documentId: 'doc-1',
      note: 'site verified',
      acceptanceId: 'acc-prev',
    });
    expect(h.rpc).toHaveBeenCalledWith('prepare_subcontract_acceptance', {
      p_po_id: 'po-1',
      p_acceptance_date: '2026-11-01',
      p_lines: [{ boq_item_id: 'b1', quantity: 120 }],
      p_document_id: 'doc-1',
      p_note: 'site verified',
      p_acceptance_id: 'acc-prev',
    });
    expect(res).toBe('acc-1');
  });

  it('confirmSubcontractAcceptance calls confirm_subcontract_acceptance', async () => {
    h.rpc.mockResolvedValue({ data: 'acc-1', error: null });
    const res = await confirmSubcontractAcceptance('acc-1');
    expect(h.rpc).toHaveBeenCalledWith('confirm_subcontract_acceptance', { p_id: 'acc-1' });
    expect(res).toBe('acc-1');
  });

  it('withdrawSubcontractAcceptance calls withdraw_subcontract_acceptance', async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    await withdrawSubcontractAcceptance('acc-1');
    expect(h.rpc).toHaveBeenCalledWith('withdraw_subcontract_acceptance', { p_id: 'acc-1' });
  });

  it('FR-SCA-020 captureSubcontractVendorInvoice forwards tax params and surfaces SC001 error with code SC001', async () => {
    h.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'line L1 cannot be billed: verified 120, PO 100, billed 0, this bill 120', code: 'SC001' },
    });

    await expect(
      captureSubcontractVendorInvoice({
        procurementId: 'proc-1',
        status: 'Received',
        invoiceDate: '2026-11-02',
        amount: 12000000,
        taxTreatment: 'exclusive',
        taxAmount: 1320000,
        taxRate: 11,
        lines: [{ boqItemId: 'b1', quantity: 120, rate: 100000 }],
      }),
    ).rejects.toMatchObject({
      code: 'SC001',
      message: expect.stringContaining('line L1 cannot be billed'),
    });

    expect(h.rpc).toHaveBeenCalledWith('capture_subcontract_vendor_invoice', {
      p_procurement_id: 'proc-1',
      p_status: 'Received',
      p_invoice_date: '2026-11-02',
      p_amount: 12000000,
      p_tax_treatment: 'exclusive',
      p_tax_amount: 1320000,
      p_tax_rate: 11,
      p_lines: [{ boq_item_id: 'b1', quantity: 120, rate: 100000 }],
    });
  });

  it('listPoVariations selects header + lines ordered by requested_at', async () => {
    h.result.data = [{ id: 'var-1', lines: [] }];
    const res = await listPoVariations('po-1');
    expect(h.from).toHaveBeenCalledWith('po_variations');
    expect(h.chain.select).toHaveBeenCalledWith('*, lines:po_variation_lines(*)');
    expect(h.chain.eq).toHaveBeenCalledWith('po_id', 'po-1');
    expect(h.chain.order).toHaveBeenCalledWith('requested_at', { ascending: false });
    expect(res).toEqual([{ id: 'var-1', lines: [] }]);
  });

  it('FR-SCA-030 requestPoVariation calls request_po_variation with mapped lines', async () => {
    h.rpc.mockResolvedValue({ data: 'var-1', error: null });
    const res = await requestPoVariation({
      poId: 'po-1',
      origin: 'post_work',
      reason: 'Extra ground rock excavated',
      lines: [{ boqItemId: 'b1', additionalQuantity: 20 }],
    });
    expect(h.rpc).toHaveBeenCalledWith('request_po_variation', {
      p_po_id: 'po-1',
      p_origin: 'post_work',
      p_reason: 'Extra ground rock excavated',
      p_lines: [{ boq_item_id: 'b1', additional_quantity: 20 }],
    });
    expect(res).toBe('var-1');
  });

  it('FR-SCA-031 decidePoVariation calls decide_po_variation with approve and notes', async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    await decidePoVariation('var-1', true, 'approved by executive');
    expect(h.rpc).toHaveBeenCalledWith('decide_po_variation', {
      p_id: 'var-1',
      p_approve: true,
      p_notes: 'approved by executive',
    });
  });

  it('FR-SCA-032 issuePoRevision calls issue_po_revision with variationId', async () => {
    h.rpc.mockResolvedValue({ data: 2, error: null });
    const res = await issuePoRevision('var-1');
    expect(h.rpc).toHaveBeenCalledWith('issue_po_revision', { p_variation_id: 'var-1' });
    expect(res).toBe(2);
  });

  it('FR-SCA-040 linkPoVariation calls link_po_variation with workOrderId or reason', async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    await linkPoVariation('var-1', 'wo-1', null);
    expect(h.rpc).toHaveBeenCalledWith('link_po_variation', {
      p_variation_id: 'var-1',
      p_work_order_id: 'wo-1',
      p_not_passed_reason: null,
    });
  });

  it('getVariationRoute calls po_variation_route and returns first row or null', async () => {
    const route = {
      approver_ids: ['u1'],
      line_budget: 50000000,
      line_used: 40000000,
      reason: 'within budget',
      route: 'standard',
    };
    h.rpc.mockResolvedValue({ data: [route], error: null });
    const res = await getVariationRoute('var-1');
    expect(h.rpc).toHaveBeenCalledWith('po_variation_route', { p_id: 'var-1' });
    expect(res).toEqual(route);

    h.rpc.mockResolvedValue({ data: [], error: null });
    expect(await getVariationRoute('var-none')).toBeNull();
  });

  it('getProjectSubcontractExposure calls project_subcontract_exposure with projectId', async () => {
    const exposure = [
      {
        currency: 'IDR',
        verified_not_on_po_value: 3000000,
        disputed_value: 0,
        oldest_unresolved_at: '2026-10-20T00:00:00Z',
      },
    ];
    h.rpc.mockResolvedValue({ data: exposure, error: null });
    const res = await getProjectSubcontractExposure('proj-1');
    expect(h.rpc).toHaveBeenCalledWith('project_subcontract_exposure', { p_project_id: 'proj-1' });
    expect(res).toEqual(exposure);
  });

  it('listWorkOrderCostVariations calls work_order_cost_variations with workOrderId', async () => {
    const variations = [{ id: 'var-1', po_id: 'po-1', number: 'VAR-01', amount: 3000000, status: 'Approved' }];
    h.rpc.mockResolvedValue({ data: variations, error: null });
    const res = await listWorkOrderCostVariations('wo-1');
    expect(h.rpc).toHaveBeenCalledWith('work_order_cost_variations', { p_work_order_id: 'wo-1' });
    expect(res).toEqual(variations);
  });

  it('listSubcontractCapExceptions calls subcontract_cap_exceptions with procurementId', async () => {
    const exceptions = [
      {
        amount: 5000000,
        erp_purchase_document_id: 'doc-erp',
        invoice_id: 'inv-1',
        number: 'BILL-01',
        reason: 'no_lines',
      },
    ];
    h.rpc.mockResolvedValue({ data: exceptions, error: null });
    const res = await listSubcontractCapExceptions('proc-1');
    expect(h.rpc).toHaveBeenCalledWith('subcontract_cap_exceptions', { p_procurement_id: 'proc-1' });
    expect(res).toEqual(exceptions);
  });

  it('attributeSubcontractBillLines calls attribute_subcontract_bill_lines with mapped lines', async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    await attributeSubcontractBillLines('inv-1', [{ boqItemId: 'b1', quantity: 50, rate: 100000 }]);
    expect(h.rpc).toHaveBeenCalledWith('attribute_subcontract_bill_lines', {
      p_invoice_id: 'inv-1',
      p_lines: [{ boq_item_id: 'b1', quantity: 50, rate: 100000 }],
    });
  });
});
