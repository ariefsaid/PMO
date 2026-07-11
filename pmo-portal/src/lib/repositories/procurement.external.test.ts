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
