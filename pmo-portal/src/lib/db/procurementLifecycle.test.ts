import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted mock setup — same builder pattern as budgets.test.ts
// ---------------------------------------------------------------------------

const { mockRpc, mockFrom, mockSelect, mockEq, mockSingle } =
  vi.hoisted(() => {
    const mockRpc = vi.fn();
    const mockFrom = vi.fn();
    const mockSelect = vi.fn();
    const mockEq = vi.fn();
    const mockSingle = vi.fn();
    return { mockRpc, mockFrom, mockSelect, mockEq, mockSingle };
  });

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: { from: mockFrom, rpc: mockRpc },
}));

import {
  isLegalTransition,
  canCancel,
  formatDocNumber,
  transitionProcurement,
  getProcurementDetail,
  createReceipt,
  createInvoice,
  createQuotation,
  ProcurementError,
} from './procurementLifecycle';

// ---------------------------------------------------------------------------
// Builder helpers (mirrors budgets.test.ts)
// ---------------------------------------------------------------------------

function makeRpcBuilder(resolved: { data: unknown; error: unknown }) {
  const builder = {
    then: (resolve: (v: typeof resolved) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(resolved).then(resolve, reject),
  };
  mockRpc.mockReturnValue(builder);
  return builder;
}

function makeFromBuilder(resolved: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  builder.select = mockSelect.mockReturnValue(builder);
  builder.eq = mockEq.mockReturnValue(builder);
  builder.single = mockSingle.mockReturnValue(builder);
  builder.then = (resolve: (v: typeof resolved) => void, reject?: (e: unknown) => void) =>
    Promise.resolve(resolved).then(resolve, reject);
  mockFrom.mockReturnValue(builder);
  return builder;
}

beforeEach(() => {
  mockRpc.mockReset();
  mockFrom.mockReset();
  mockSelect.mockReset();
  mockEq.mockReset();
  mockSingle.mockReset();
});

// ---------------------------------------------------------------------------
// B1/B2 — Transition map (AC-800)
// ---------------------------------------------------------------------------

describe('isLegalTransition', () => {
  it('AC-800: transition map accepts legal pairs, rejects illegal jumps and terminal exits (FR-PROC-001)', () => {
    // Legal transitions
    expect(isLegalTransition('Draft', 'Requested')).toBe(true);
    expect(isLegalTransition('Requested', 'Approved')).toBe(true);
    expect(isLegalTransition('Requested', 'Rejected')).toBe(true);
    expect(isLegalTransition('Rejected', 'Draft')).toBe(true);

    // Illegal jump — skips many stages
    expect(isLegalTransition('Draft', 'Paid')).toBe(false);

    // Terminal — Paid has no outgoing transitions
    expect(isLegalTransition('Paid', 'Requested')).toBe(false);
    expect(isLegalTransition('Paid', 'Draft')).toBe(false);
    expect(isLegalTransition('Cancelled', 'Draft')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B3 — Skippable optional stages (AC-801)
// ---------------------------------------------------------------------------

describe('isLegalTransition — skippable stages', () => {
  it('AC-801: Approved→Ordered (skip sourcing), Approved→Vendor Quoted, Quote Selected→Ordered are legal (FR-PROC-002)', () => {
    expect(isLegalTransition('Approved', 'Ordered')).toBe(true);       // skip sourcing
    expect(isLegalTransition('Approved', 'Vendor Quoted')).toBe(true); // full sourcing path start
    expect(isLegalTransition('Quote Selected', 'Ordered')).toBe(true); // end of sourcing path
  });
});

// ---------------------------------------------------------------------------
// B4 — Cancel boundary (AC-802)
// ---------------------------------------------------------------------------

describe('canCancel', () => {
  it('AC-802: requester may cancel at Requested, not at Ordered; Paid/Cancelled never cancellable (FR-PROC-002/009, OD-PROC-B)', () => {
    // Requester can cancel early (Draft/Requested)
    expect(canCancel('Engineer', true, 'Requested')).toBe(true);
    expect(canCancel('Engineer', true, 'Draft')).toBe(true);

    // Requester CANNOT cancel at late stage (Ordered)
    expect(canCancel('Engineer', true, 'Ordered')).toBe(false);

    // PM (non-requester) can cancel at late stage
    expect(canCancel('Project Manager', false, 'Ordered')).toBe(true);

    // Nobody can cancel terminal states
    expect(canCancel('Project Manager', false, 'Paid')).toBe(false);
    expect(canCancel('Project Manager', false, 'Cancelled')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B5 — Ref-number formatter (AC-803)
// ---------------------------------------------------------------------------

describe('formatDocNumber', () => {
  it('AC-803: formatDocNumber pads width-4 — PO+2026-06-04+1 → PO-2606040001, seq 42 → PO-2606040042 (FR-PROC-010)', () => {
    const date = new Date('2026-06-04');
    expect(formatDocNumber('PO', date, 1)).toBe('PO-2606040001');
    expect(formatDocNumber('PO', date, 42)).toBe('PO-2606040042');
    expect(formatDocNumber('PR', date, 1)).toBe('PR-2606040001');
    expect(formatDocNumber('VQ', date, 999)).toBe('VQ-2606040999');
    expect(formatDocNumber('GR', date, 1000)).toBe('GR-2606041000');
  });
});

// ---------------------------------------------------------------------------
// B6 — DAL RPC error surfacing (AC-806)
// ---------------------------------------------------------------------------

describe('transitionProcurement', () => {
  it('AC-806: transitionProcurement surfaces the RPC 42501/P0001 error (does not swallow) (FR-PROC-003/004)', async () => {
    makeRpcBuilder({ data: null, error: { message: 'not authorized', code: '42501' } });
    await expect(transitionProcurement('proc-id', 'Approved')).rejects.toThrow('not authorized');
  });

  it('AC-806: preserves the Postgres error.code on the thrown error (P0001 illegal-stage)', async () => {
    makeRpcBuilder({
      data: null,
      error: { message: 'illegal transition', code: 'P0001' },
    });
    await expect(transitionProcurement('proc-id', 'Approved')).rejects.toMatchObject({
      message: 'illegal transition',
      code: 'P0001',
    });
  });

  it('AC-806: preserves the 42501 not-permitted (SoD) error.code on the thrown error', async () => {
    makeRpcBuilder({
      data: null,
      error: { message: 'permission denied', code: '42501' },
    });
    const err = await transitionProcurement('proc-id', 'Paid').catch((e) => e);
    expect(err).toBeInstanceOf(ProcurementError);
    expect((err as ProcurementError).code).toBe('42501');
    // the verbatim RPC message is preserved as the secondary detail
    expect((err as ProcurementError).message).toBe('permission denied');
  });

  it('calls rpc with correct param names: p_id, p_to, p_notes (FR-PROC-003)', async () => {
    makeRpcBuilder({ data: null, error: null });
    await transitionProcurement('proc-id', 'Requested', 'some notes');
    expect(mockRpc).toHaveBeenCalledWith('transition_procurement', {
      p_id: 'proc-id',
      p_to: 'Requested',
      p_notes: 'some notes',
    });
  });

  it('sends p_notes as null when notes are omitted (FR-PROC-003)', async () => {
    makeRpcBuilder({ data: null, error: null });
    await transitionProcurement('proc-id', 'Requested');
    expect(mockRpc).toHaveBeenCalledWith('transition_procurement', {
      p_id: 'proc-id',
      p_to: 'Requested',
      p_notes: null,
    });
  });

  it('does not send org_id to the RPC (FR-PROC-004)', async () => {
    makeRpcBuilder({ data: null, error: null });
    await transitionProcurement('proc-id', 'Approved');
    expect(JSON.stringify(mockRpc.mock.calls)).not.toContain('org_id');
  });
});

// ---------------------------------------------------------------------------
// B7 — getProcurementDetail + create* DAL fns (supports AC-816)
// ---------------------------------------------------------------------------

describe('getProcurementDetail', () => {
  it('AC-816 (DAL): selects procurement with all related joins for the given id', async () => {
    const detailRow = {
      id: 'proc-1',
      title: 'Test Proc',
      status: 'Draft',
      project: { name: 'Test Project', code: 'PRJ-001' },
      vendor: { name: 'ACME Corp' },
      requested_by: { full_name: 'Alice' },
      approved_by: null,
      items: [],
      quotations: [],
      receipts: [],
      invoices: [],
    };
    makeFromBuilder({ data: detailRow, error: null });

    const result = await getProcurementDetail('proc-1');

    expect(mockFrom).toHaveBeenCalledWith('procurements');
    // items:procurement_items(*) added for the editable line-items table (CRUD slice).
    // N8 (AC-IXD-PROC-W5-2): the DecisionSupportPanel sources committed spend via
    // useProjectCommittedSpend (the honest Σ-PO basis), so the project join stays name/code.
    // Slice 6.1: DETAIL_SELECT now includes the four new record-type embeds + statusEvents.
    // The assertion captures the full shape; partial match via toContain ensures additive
    // extensions to DETAIL_SELECT stay test-visible without re-enumerating every join.
    expect(mockSelect).toHaveBeenCalledWith(
      expect.stringContaining('purchase_requests:purchase_requests(*)'),
    );
    expect(mockSelect).toHaveBeenCalledWith(
      expect.stringContaining('rfqs:rfqs(*)'),
    );
    expect(mockSelect).toHaveBeenCalledWith(
      expect.stringContaining('purchase_orders:purchase_orders(*)'),
    );
    expect(mockSelect).toHaveBeenCalledWith(
      expect.stringContaining('payments:payments(*)'),
    );
    // statusEvents embed now includes the actor profile join for name resolution (AC-PR-PROG-012)
    expect(mockSelect).toHaveBeenCalledWith(
      expect.stringContaining('statusEvents:procurement_status_events(*, actor:profiles!'),
    );
    // Also assert the core legacy joins are still present (NFR-PR-PERF-002 one embed)
    expect(mockSelect).toHaveBeenCalledWith(
      expect.stringContaining('items:procurement_items(*)'),
    );
    expect(mockSelect).toHaveBeenCalledWith(
      expect.stringContaining('receipts:procurement_receipts(*)'),
    );
    expect(mockEq).toHaveBeenCalledWith('id', 'proc-1');
    expect(mockSingle).toHaveBeenCalled();
    expect(result).toMatchObject({ id: 'proc-1', title: 'Test Proc' });
  });

  it('AC-816 (DAL): throws on PostgREST error', async () => {
    makeFromBuilder({ data: null, error: { message: 'not found' } });
    await expect(getProcurementDetail('bad-id')).rejects.toThrow('not found');
  });

  it('AC-816 (DAL): sends no org_id — RLS scopes via auth_org_id()', async () => {
    makeFromBuilder({ data: { id: 'proc-1' }, error: null });
    await getProcurementDetail('proc-1');
    expect(JSON.stringify(mockEq.mock.calls)).not.toContain('org_id');
  });
});

describe('createReceipt', () => {
  it('AC-816 (DAL): createReceipt calls rpc("create_procurement_receipt", {p_procurement_id, p_status, p_receipt_date}) and returns the row', async () => {
    const receiptRow = {
      id: 'receipt-1',
      procurement_id: 'proc-1',
      status: 'Partial',
      gr_number: 'GR-2606040001',
      receipt_date: '2026-06-04',
      org_id: 'org-1',
      created_at: '2026-06-04T00:00:00Z',
    };
    makeRpcBuilder({ data: receiptRow, error: null });

    const result = await createReceipt('proc-1', 'Partial', '2026-06-04');

    expect(mockRpc).toHaveBeenCalledWith('create_procurement_receipt', {
      p_procurement_id: 'proc-1',
      p_status: 'Partial',
      p_receipt_date: '2026-06-04',
    });
    expect(result).toMatchObject({ id: 'receipt-1', gr_number: 'GR-2606040001' });
  });

  it('AC-816 (DAL): createReceipt throws on RPC error', async () => {
    makeRpcBuilder({ data: null, error: { message: 'rpc error' } });
    await expect(createReceipt('proc-1', 'Partial', '2026-06-04')).rejects.toThrow('rpc error');
  });
});

describe('createInvoice', () => {
  it('AC-816 (DAL): createInvoice calls rpc("create_procurement_invoice", {p_procurement_id, p_status, p_invoice_date}) and returns the row', async () => {
    const invoiceRow = {
      id: 'invoice-1',
      procurement_id: 'proc-1',
      status: 'Received',
      vi_number: 'VI-2606040001',
      invoice_date: '2026-06-04',
      org_id: 'org-1',
      created_at: '2026-06-04T00:00:00Z',
    };
    makeRpcBuilder({ data: invoiceRow, error: null });

    const result = await createInvoice('proc-1', 'Received', '2026-06-04');

    expect(mockRpc).toHaveBeenCalledWith('create_procurement_invoice', {
      p_procurement_id: 'proc-1',
      p_status: 'Received',
      p_invoice_date: '2026-06-04',
    });
    expect(result).toMatchObject({ id: 'invoice-1', vi_number: 'VI-2606040001' });
  });

  it('AC-816 (DAL): createInvoice throws on RPC error', async () => {
    makeRpcBuilder({ data: null, error: { message: 'invoice error' } });
    await expect(createInvoice('proc-1', 'Received', '2026-06-04')).rejects.toThrow('invoice error');
  });
});

describe('createQuotation', () => {
  it('AC-816 (DAL): createQuotation calls rpc("create_procurement_quotation", correct args) and returns the row', async () => {
    const quotationRow = {
      id: 'quote-1',
      procurement_id: 'proc-1',
      vendor_id: 'vendor-1',
      total_amount: 50000,
      received_date: '2026-06-04',
      vq_number: 'VQ-2606040001',
      is_selected: false,
      reference: null,
      org_id: 'org-1',
      created_at: '2026-06-04T00:00:00Z',
    };
    makeRpcBuilder({ data: quotationRow, error: null });

    const result = await createQuotation('proc-1', 'vendor-1', 50000, '2026-06-04');

    expect(mockRpc).toHaveBeenCalledWith('create_procurement_quotation', {
      p_procurement_id: 'proc-1',
      p_vendor_id: 'vendor-1',
      p_total_amount: 50000,
      p_received_date: '2026-06-04',
    });
    expect(result).toMatchObject({ id: 'quote-1', vq_number: 'VQ-2606040001' });
  });

  it('AC-816 (DAL): createQuotation throws on RPC error', async () => {
    makeRpcBuilder({ data: null, error: { message: 'quotation error' } });
    await expect(createQuotation('proc-1', 'vendor-1', 50000, '2026-06-04')).rejects.toThrow('quotation error');
  });
});
