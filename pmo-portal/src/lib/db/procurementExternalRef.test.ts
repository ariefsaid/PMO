import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, from: vi.fn() } }));

import { buildLedgerRows } from './procurementLedger';
import { externalRefsOf, type ProcurementWithRefs } from './procurements';
import { createPurchaseRequest, createPurchaseOrder } from './procurementRecords';
import { createInvoice, captureVendorInvoice, type ProcurementDetail } from './procurementLifecycle';

beforeEach(() => {
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: { id: 'x' }, error: null });
});

const detail = {
  id: 'p1', created_at: '2026-01-01T00:00:00Z', currency: 'USD',
  quotations: [], receipts: [], rfqs: [], payments: [],
  purchase_requests: [{ id: 'pr1', date: '2026-01-02', created_at: '2026-01-02T00:00:00Z', pr_number: 'PR-1', reference_number: null, amount: 1, status: 'Draft', currency: 'USD', external_ref: 'PRQ-001' }],
  purchase_orders: [{ id: 'po1', date: '2026-01-03', created_at: '2026-01-03T00:00:00Z', po_number: 'PO-1', reference_number: null, amount: 1, status: 'Draft', currency: 'USD', external_ref: 'PRO-002' }],
  invoices: [{ id: 'vi1', invoice_date: '2026-01-04', created_at: '2026-01-04T00:00:00Z', vi_number: 'VI-1', reference_number: 'INV-9', amount: 1, status: 'Received', currency: 'USD', tax_treatment: 'exclusive', tax_rate: null, tax_base_numerator: 1, tax_base_denominator: 1, erp_docstatus: null, external_ref: 'PRO-002' }],
} as unknown as ProcurementDetail;

describe('#769 external reference — ledger, list search keys, RPC args', () => {
  it('AC-EXT-002: the ledger rows carry the PR, PO and vendor-invoice external reference', () => {
    const rows = buildLedgerRows(detail);
    expect(rows.find((r) => r.type === 'PR')?.groupRef).toBe('PRQ-001');
    expect(rows.find((r) => r.type === 'PO')?.groupRef).toBe('PRO-002');
    expect(rows.find((r) => r.type === 'Invoice')?.groupRef).toBe('PRO-002');
    // the record's own reference_number is untouched
    expect(rows.find((r) => r.type === 'Invoice')?.externalRef).toBe('INV-9');
  });

  it('AC-EXT-001: externalRefsOf gathers every non-empty reference across the three record kinds', () => {
    const p = { pr_refs: [{ external_ref: 'A' }, { external_ref: null }], po_refs: [{ external_ref: 'B' }], vi_refs: [{ external_ref: 'C' }] } as unknown as ProcurementWithRefs;
    expect(externalRefsOf(p)).toEqual(['A', 'B', 'C']);
    expect(externalRefsOf({} as ProcurementWithRefs)).toEqual([]);
  });

  it('AC-EXT-001: create PR / PO send p_external_ref only when given', async () => {
    await createPurchaseRequest('p1', null, null, null, null, undefined, undefined, undefined, 'PRQ-001');
    expect(h.rpc).toHaveBeenLastCalledWith('create_purchase_request', expect.objectContaining({ p_external_ref: 'PRQ-001' }));
    await createPurchaseOrder('p1', null, null, null, null);
    expect(h.rpc.mock.calls.at(-1)![1]).not.toHaveProperty('p_external_ref');
    await createPurchaseOrder('p1', null, null, null, null, undefined, undefined, undefined, 'PRO-002');
    expect(h.rpc).toHaveBeenLastCalledWith('create_purchase_order', expect.objectContaining({ p_external_ref: 'PRO-002' }));
  });

  it('AC-EXT-001: create / capture vendor invoice forward p_external_ref', async () => {
    const base = { procurementId: 'p1', status: 'Received' as const, invoiceDate: '2026-01-04', taxTreatment: 'exclusive' as const, taxAmount: 0 };
    await createInvoice({ ...base, externalRef: 'PRO-002' });
    expect(h.rpc).toHaveBeenLastCalledWith('create_procurement_invoice', expect.objectContaining({ p_external_ref: 'PRO-002' }));
    await captureVendorInvoice({ ...base, externalRef: 'PRO-002' });
    expect(h.rpc).toHaveBeenLastCalledWith('capture_vendor_invoice', expect.objectContaining({ p_external_ref: 'PRO-002' }));
    await captureVendorInvoice(base);
    expect(h.rpc.mock.calls.at(-1)![1]).not.toHaveProperty('p_external_ref');
  });
});
