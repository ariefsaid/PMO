import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * AC-ENA-001 — the byte-for-byte regression net (Slice 1, EARLY per the plan's binding ordering).
 *
 * With an empty/cold ownership map (the state of every non-flipped org — every client that does NOT
 * employ ERPNext, FR-ENA-004), every procurement/company write on `repositories.procurement.*` /
 * `repositories.company.*` must keep hitting the EXISTING direct DAL (RPC/insert/update) — never
 * `dispatchDomainCommand` — and produce byte-for-byte the same returned row / thrown `.code` as
 * pre-P2. This is the single owning test for AC-ENA-001; it MUST land before any repository routing
 * wiring touches the procurement/companies path (plan §2 point 7 — the P1 C1 discipline).
 */

vi.mock('@/src/lib/db/procurementRecords', () => ({
  createPurchaseRequest: vi.fn(),
  createRfq: vi.fn(),
  createPurchaseOrder: vi.fn(),
  createPayment: vi.fn(),
}));
vi.mock('@/src/lib/db/procurementLifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/db/procurementLifecycle')>();
  return {
    ...actual,
    getProcurementDetail: vi.fn(),
    transitionProcurement: vi.fn(),
    createQuotation: vi.fn(),
    createReceipt: vi.fn(),
    createInvoice: vi.fn(),
  };
});
vi.mock('@/src/lib/db/companies', () => ({
  createCompany: vi.fn(),
  updateCompany: vi.fn(),
  listClientCompanies: vi.fn(),
  listCompanies: vi.fn(),
  getCompany: vi.fn(),
  archiveCompany: vi.fn(),
  deleteCompany: vi.fn(),
}));

import * as dispatchClient from '@/src/lib/adapterSeam/dispatchClient';
import { clearOwnershipCache, setDomainOwnership } from '@/src/lib/adapterSeam/ownershipCache';
import { repositories } from '@/src/lib/repositories';
import {
  createPurchaseRequest,
  createRfq,
  createPurchaseOrder,
  createPayment,
} from '@/src/lib/db/procurementRecords';
import {
  transitionProcurement,
  createQuotation,
  createReceipt,
  createInvoice,
  ProcurementError,
} from '@/src/lib/db/procurementLifecycle';
import { createCompany, updateCompany } from '@/src/lib/db/companies';
import { AppError } from '@/src/lib/appError';

// The single spy target for every "must never dispatch externally" assertion below. On a cold
// ownership map every write in this file must leave this spy uncalled (AC-ENA-001).
// `as never` — `dispatchDomainCommand` is not yet an export of `dispatchClient.ts` (task 1.11 adds
// it); spying on a genuinely-absent property is exactly what makes this test RED until then.
let dispatchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  clearOwnershipCache();
  dispatchSpy = vi.spyOn(dispatchClient as never, 'dispatchDomainCommand' as never);
});

describe('AC-ENA-001 cold ownership map — procurement writes stay on the direct DAL', () => {
  it('AC-ENA-001 createPurchaseRequest calls the existing RPC and never dispatches', async () => {
    const row = { id: 'pr-1', reference_number: 'PR-0001' };
    vi.mocked(createPurchaseRequest).mockResolvedValue(row as never);
    const result = await repositories.procurement.createPurchaseRequest('proc-1', 'PR-0001', 'Draft', '2026-07-11', 100);
    expect(createPurchaseRequest).toHaveBeenCalledWith('proc-1', 'PR-0001', 'Draft', '2026-07-11', 100);
    expect(result).toBe(row);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('AC-ENA-001 createRfq calls the existing RPC and never dispatches', async () => {
    const row = { id: 'rfq-1' };
    vi.mocked(createRfq).mockResolvedValue(row as never);
    const result = await repositories.procurement.createRfq('proc-1', 'RFQ-0001', 'Draft', '2026-07-11', 100);
    expect(createRfq).toHaveBeenCalledWith('proc-1', 'RFQ-0001', 'Draft', '2026-07-11', 100);
    expect(result).toBe(row);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('AC-ENA-001 createPurchaseOrder calls the existing RPC and never dispatches', async () => {
    const row = { id: 'po-1' };
    vi.mocked(createPurchaseOrder).mockResolvedValue(row as never);
    const result = await repositories.procurement.createPurchaseOrder('proc-1', 'PO-0001', 'Draft', '2026-07-11', 100);
    expect(createPurchaseOrder).toHaveBeenCalledWith('proc-1', 'PO-0001', 'Draft', '2026-07-11', 100);
    expect(result).toBe(row);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('AC-ENA-001 createPayment calls the existing RPC and never dispatches', async () => {
    const row = { id: 'pay-1' };
    vi.mocked(createPayment).mockResolvedValue(row as never);
    const result = await repositories.procurement.createPayment('proc-1', 'inv-1', 'PAY-0001', 'Draft', '2026-07-11', 100);
    expect(createPayment).toHaveBeenCalledWith('proc-1', 'inv-1', 'PAY-0001', 'Draft', '2026-07-11', 100);
    expect(result).toBe(row);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('AC-ENA-001 createQuotation calls the existing RPC and never dispatches', async () => {
    const row = { id: 'quo-1' };
    vi.mocked(createQuotation).mockResolvedValue(row as never);
    const result = await repositories.procurement.createQuotation('proc-1', 'vendor-1', 100, '2026-07-11');
    expect(createQuotation).toHaveBeenCalledWith('proc-1', 'vendor-1', 100, '2026-07-11');
    expect(result).toBe(row);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('AC-ENA-001 createReceipt calls the existing RPC and never dispatches', async () => {
    const row = { id: 'gr-1' };
    vi.mocked(createReceipt).mockResolvedValue(row as never);
    const result = await repositories.procurement.createReceipt('proc-1', 'Complete', '2026-07-11');
    expect(createReceipt).toHaveBeenCalledWith('proc-1', 'Complete', '2026-07-11');
    expect(result).toBe(row);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('AC-ENA-001 createInvoice calls the existing RPC and never dispatches', async () => {
    const row = { id: 'inv-1' };
    vi.mocked(createInvoice).mockResolvedValue(row as never);
    const result = await repositories.procurement.createInvoice('proc-1', 'Received', '2026-07-11');
    expect(createInvoice).toHaveBeenCalledWith('proc-1', 'Received', '2026-07-11');
    expect(result).toBe(row);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('AC-ENA-001 transitionProcurement calls the existing RPC and never dispatches', async () => {
    vi.mocked(transitionProcurement).mockResolvedValue(undefined);
    await repositories.procurement.transition('proc-1', 'Approved', 'looks good');
    expect(transitionProcurement).toHaveBeenCalledWith('proc-1', 'Approved', 'looks good');
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('AC-ENA-001 a thrown DAL error keeps its exact pre-P2 shape (AppError, code preserved)', async () => {
    vi.mocked(transitionProcurement).mockRejectedValue(new ProcurementError('illegal transition', 'P0001'));
    await expect(repositories.procurement.transition('proc-1', 'Approved')).rejects.toBeInstanceOf(AppError);
    await expect(repositories.procurement.transition('proc-1', 'Approved')).rejects.toMatchObject({ code: 'P0001' });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});

describe('AC-ENA-001 cold ownership map — company writes stay on the direct DAL', () => {
  it('AC-ENA-001 company.create calls the existing insert and never dispatches', async () => {
    const row = { id: 'co-1', name: 'Acme', type: 'Vendor' };
    vi.mocked(createCompany).mockResolvedValue(row as never);
    const result = await repositories.company.create({ name: 'Acme', type: 'Vendor' });
    expect(createCompany).toHaveBeenCalledWith({ name: 'Acme', type: 'Vendor' });
    expect(result).toBe(row);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('AC-ENA-001 company.update calls the existing update and never dispatches', async () => {
    vi.mocked(updateCompany).mockResolvedValue(undefined);
    await repositories.company.update('co-1', { name: 'Acme Renamed', type: 'Vendor' });
    expect(updateCompany).toHaveBeenCalledWith('co-1', { name: 'Acme Renamed', type: 'Vendor' });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('AC-ENA-001 a thrown DAL error on company.create keeps its exact pre-P2 shape (AppError, code preserved)', async () => {
    vi.mocked(createCompany).mockRejectedValue(new AppError('denied', '42501'));
    await expect(repositories.company.create({ name: 'Acme', type: 'Vendor' })).rejects.toBeInstanceOf(AppError);
    await expect(repositories.company.create({ name: 'Acme', type: 'Vendor' })).rejects.toMatchObject({ code: '42501' });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});

/**
 * Task 4.8 — a FLIPPED ownership map ('procurement'/'companies' -> 'erpnext') routes the record
 * creates to `dispatchDomainCommand`, each carrying its `erp_doc_kind` + a minted `idempotencyKey`
 * (never a bare DAL call). Non-flipped stays byte-for-byte (proven above) — this is the OTHER half of
 * the routing guard task 1.10 already shipped.
 */
describe('task 4.8 — flipped ownership map — procurement/company record creates route to dispatchDomainCommand', () => {
  beforeEach(() => {
    setDomainOwnership([
      { domain: 'procurement', externalTier: 'erpnext' },
      { domain: 'companies', externalTier: 'erpnext' },
    ]);
  });

  it('createPurchaseRequest dispatches externally with erp_doc_kind + a minted idempotencyKey', async () => {
    dispatchSpy.mockResolvedValue({ externalRecordId: 'MAT-REQ-2026-00001', canonical: { id: 'pmo-1', pr_number: 'MAT-REQ-2026-00001' } });
    await repositories.procurement.createPurchaseRequest('proc-1', 'PR-0001', 'Draft', '2026-07-11', 100);
    expect(createPurchaseRequest).not.toHaveBeenCalled();
    expect(dispatchSpy).toHaveBeenCalledWith(
      'procurement',
      'create',
      expect.objectContaining({ procurementId: 'proc-1', erp_doc_kind: 'purchase-request' }),
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });

  it('createRfq dispatches externally with erp_doc_kind rfq', async () => {
    dispatchSpy.mockResolvedValue({ externalRecordId: 'PUR-RFQ-2026-00001', canonical: { id: 'pmo-1' } });
    await repositories.procurement.createRfq('proc-1', 'RFQ-0001', 'Draft', '2026-07-11', 100);
    expect(createRfq).not.toHaveBeenCalled();
    expect(dispatchSpy).toHaveBeenCalledWith('procurement', 'create', expect.objectContaining({ erp_doc_kind: 'rfq' }), expect.any(Object));
  });

  it('createPurchaseOrder dispatches externally with erp_doc_kind purchase-order', async () => {
    dispatchSpy.mockResolvedValue({ externalRecordId: 'PUR-ORD-2026-00001', canonical: { id: 'pmo-1' } });
    await repositories.procurement.createPurchaseOrder('proc-1', 'PO-0001', 'Draft', '2026-07-11', 100);
    expect(createPurchaseOrder).not.toHaveBeenCalled();
    expect(dispatchSpy).toHaveBeenCalledWith('procurement', 'create', expect.objectContaining({ erp_doc_kind: 'purchase-order' }), expect.any(Object));
  });

  it('createPayment dispatches externally with erp_doc_kind payment', async () => {
    dispatchSpy.mockResolvedValue({ externalRecordId: 'ACC-PAY-2026-00001', canonical: { id: 'pmo-1' } });
    await repositories.procurement.createPayment('proc-1', 'inv-1', 'PAY-0001', 'Draft', '2026-07-11', 100);
    expect(createPayment).not.toHaveBeenCalled();
    expect(dispatchSpy).toHaveBeenCalledWith('procurement', 'create', expect.objectContaining({ erp_doc_kind: 'payment' }), expect.any(Object));
  });

  it('createQuotation dispatches externally with erp_doc_kind quotation', async () => {
    dispatchSpy.mockResolvedValue({ externalRecordId: 'PUR-SQTN-2026-00001', canonical: { id: 'pmo-1' } });
    await repositories.procurement.createQuotation('proc-1', 'vendor-1', 100, '2026-07-11');
    expect(createQuotation).not.toHaveBeenCalled();
    expect(dispatchSpy).toHaveBeenCalledWith('procurement', 'create', expect.objectContaining({ erp_doc_kind: 'quotation' }), expect.any(Object));
  });

  it('createReceipt dispatches externally with erp_doc_kind goods-receipt', async () => {
    dispatchSpy.mockResolvedValue({ externalRecordId: 'MAT-PRE-2026-00001', canonical: { id: 'pmo-1' } });
    await repositories.procurement.createReceipt('proc-1', 'Complete', '2026-07-11');
    expect(createReceipt).not.toHaveBeenCalled();
    expect(dispatchSpy).toHaveBeenCalledWith('procurement', 'create', expect.objectContaining({ erp_doc_kind: 'goods-receipt' }), expect.any(Object));
  });

  it('createInvoice dispatches externally with erp_doc_kind purchase-invoice', async () => {
    dispatchSpy.mockResolvedValue({ externalRecordId: 'ACC-PINV-2026-00002', canonical: { id: 'pmo-1' } });
    await repositories.procurement.createInvoice('proc-1', 'Received', '2026-07-11');
    expect(createInvoice).not.toHaveBeenCalled();
    expect(dispatchSpy).toHaveBeenCalledWith('procurement', 'create', expect.objectContaining({ erp_doc_kind: 'purchase-invoice' }), expect.any(Object));
  });

  it('company.create dispatches externally with erp_doc_kind supplier', async () => {
    dispatchSpy.mockResolvedValue({ externalRecordId: 'Supplier:Acme', canonical: { id: 'pmo-1', name: 'Acme', type: 'Vendor' } });
    await repositories.company.create({ name: 'Acme', type: 'Vendor' });
    expect(createCompany).not.toHaveBeenCalled();
    expect(dispatchSpy).toHaveBeenCalledWith('companies', 'create', expect.objectContaining({ erp_doc_kind: 'supplier' }), expect.any(Object));
  });

  it('company.update dispatches externally with erp_doc_kind supplier', async () => {
    dispatchSpy.mockResolvedValue({ externalRecordId: 'Supplier:Acme', canonical: { id: 'co-1' } });
    await repositories.company.update('co-1', { name: 'Acme Renamed', type: 'Vendor' });
    expect(updateCompany).not.toHaveBeenCalled();
    expect(dispatchSpy).toHaveBeenCalledWith('companies', 'update', expect.objectContaining({ erp_doc_kind: 'supplier' }), expect.any(Object));
  });
});

/**
 * Task 4.9 (the "finding-3 path fix") — `procurement.transition` (the PMO CASE-AGGREGATE status
 * transition, `transitionProcurement`'s `(id, to, notes)` DAL signature) is NOT a per-doctype ERP
 * command — `to` is a PMO `ProcurementStatus` (e.g. 'Approved'), which the erpnext adapter has no
 * concept of. Per FR-ENA-101/073, the case aggregate's status is ALWAYS PMO-derived, so this write
 * MUST stay on the direct DAL path even when `procurement` is externally-owned — never routed through
 * `dispatchDomainCommand`. (This was mis-routed by an earlier task's `routeDomainWrite('procurement')`
 * guard on `transition`; task 4.9 asserts the fix.)
 */
describe('task 4.9 — transition_procurement stays on the PMO DAL path even when procurement is flipped', () => {
  it('procurement.transition calls the existing RPC and never dispatches, even under a flipped ownership map', async () => {
    setDomainOwnership([{ domain: 'procurement', externalTier: 'erpnext' }]);
    vi.mocked(transitionProcurement).mockResolvedValue(undefined);
    await repositories.procurement.transition('proc-1', 'Approved', 'looks good');
    expect(transitionProcurement).toHaveBeenCalledWith('proc-1', 'Approved', 'looks good');
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});

// Slice 5, task 5.6 (finding-3 path fix): a FLIPPED org's PO/GR creates route to
// dispatchDomainCommand, never the direct DAL — the mirror of task.external.test.ts's "loaded cache"
// describe block. Appended (not editing the AC-ENA-001 blocks above) — the cold-map assertions above
// stay byte-for-byte and untouched.
describe('AC-ENA-052 loaded cache asserting procurement→erpnext — PO/GR creates route externally', () => {
  beforeEach(() => {
    setDomainOwnership([{ domain: 'procurement', externalTier: 'erpnext' }]);
  });
  afterEach(() => {
    clearOwnershipCache();
  });

  it('AC-ENA-052 createPurchaseOrder routes to dispatchDomainCommand with erp_doc_kind + a minted idempotencyKey', async () => {
    dispatchSpy.mockResolvedValueOnce({ externalRecordId: 'PUR-ORD-2026-00001', canonical: { id: 'po-1', po_number: 'PUR-ORD-2026-00001' } });
    const result = await repositories.procurement.createPurchaseOrder('proc-1', 'PO-0001', 'Draft', '2026-07-11', 100);
    expect(createPurchaseOrder).not.toHaveBeenCalled();
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const [domain, operation, record, options] = dispatchSpy.mock.calls[0] as unknown as [string, string, Record<string, unknown>, { idempotencyKey?: string }];
    expect(domain).toBe('procurement');
    expect(operation).toBe('create');
    expect(record.erp_doc_kind).toBe('purchase-order');
    expect(record.procurementId).toBe('proc-1');
    expect(typeof options?.idempotencyKey).toBe('string');
    expect(options!.idempotencyKey!.length).toBeGreaterThan(0);
    expect(result).toMatchObject({ id: 'po-1', po_number: 'PUR-ORD-2026-00001' });
  });

  it('AC-ENA-052 createReceipt routes to dispatchDomainCommand with erp_doc_kind=goods-receipt + a minted idempotencyKey', async () => {
    dispatchSpy.mockResolvedValueOnce({ externalRecordId: 'MAT-PRE-2026-00001', canonical: { id: 'gr-1', gr_number: 'MAT-PRE-2026-00001' } });
    const result = await repositories.procurement.createReceipt('proc-1', 'Complete', '2026-07-11');
    expect(createReceipt).not.toHaveBeenCalled();
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const [domain, operation, record, options] = dispatchSpy.mock.calls[0] as unknown as [string, string, Record<string, unknown>, { idempotencyKey?: string }];
    expect(domain).toBe('procurement');
    expect(operation).toBe('create');
    expect(record.erp_doc_kind).toBe('goods-receipt');
    expect(record.procurementId).toBe('proc-1');
    expect(typeof options?.idempotencyKey).toBe('string');
    expect(result).toMatchObject({ id: 'gr-1', gr_number: 'MAT-PRE-2026-00001' });
  });
});

describe('task 3.8 (finding-3 path fix) — a flipped org routes company writes to dispatchDomainCommand with the type-derived erp_doc_kind', () => {
  beforeEach(() => {
    setDomainOwnership([{ domain: 'companies', externalTier: 'erpnext' }]);
  });

  it('a Vendor create dispatches with erp_doc_kind="supplier" and never calls the direct DAL', async () => {
    const canonical = { id: 'co-1', name: 'Acme', type: 'Vendor' };
    dispatchSpy.mockResolvedValue({ externalRecordId: 'Supplier:Acme', canonical });
    const result = await repositories.company.create({ name: 'Acme', type: 'Vendor' });
    expect(dispatchSpy).toHaveBeenCalledWith(
      'companies',
      'create',
      expect.objectContaining({ name: 'Acme', type: 'Vendor', erp_doc_kind: 'supplier' }),
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(createCompany).not.toHaveBeenCalled();
    expect(result).toEqual(canonical);
  });

  it('a Client create dispatches with erp_doc_kind="customer"', async () => {
    const canonical = { id: 'co-2', name: 'Acme Buyer', type: 'Client' };
    dispatchSpy.mockResolvedValue({ externalRecordId: 'Customer:Acme Buyer', canonical });
    await repositories.company.create({ name: 'Acme Buyer', type: 'Client' });
    expect(dispatchSpy).toHaveBeenCalledWith(
      'companies',
      'create',
      expect.objectContaining({ erp_doc_kind: 'customer' }),
      expect.anything(),
    );
    expect(createCompany).not.toHaveBeenCalled();
  });

  it('a Vendor update dispatches with erp_doc_kind="supplier"', async () => {
    dispatchSpy.mockResolvedValue({ externalRecordId: 'Supplier:Acme', canonical: { id: 'co-1', name: 'Acme Renamed', type: 'Vendor' } });
    await repositories.company.update('co-1', { name: 'Acme Renamed', type: 'Vendor' });
    expect(dispatchSpy).toHaveBeenCalledWith(
      'companies',
      'update',
      expect.objectContaining({ id: 'co-1', erp_doc_kind: 'supplier' }),
      expect.anything(),
    );
    expect(updateCompany).not.toHaveBeenCalled();
  });

  it('an Internal-type company is NEVER dispatched (FR-ENA-090/091 — Internal is never ERP-flipped), even on a flipped org', async () => {
    const row = { id: 'co-3', name: 'PMO Internal', type: 'Internal' };
    vi.mocked(createCompany).mockResolvedValue(row as never);
    const result = await repositories.company.create({ name: 'PMO Internal', type: 'Internal' });
    expect(createCompany).toHaveBeenCalledWith({ name: 'PMO Internal', type: 'Internal' });
    expect(result).toBe(row);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});
