import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * AC-SAR-001 — the byte-for-byte regression net (Slice 2, EARLY per the plan's binding ordering).
 *
 * With an empty/cold ownership map (the state of every non-flipped org — every client that does NOT
 * employ ERPNext for revenue, FR-SAR-004), every revenue write on `repositories.revenue.*`
 * must be rejected at the repository layer with `revenue-not-enabled` (OQ-SAR-6: no PMO-native path
 * today) and **never** dispatch — `dispatchSpy` uncalled.
 *
 * A flipped-org revenue command (setDomainOwnership `revenue`→`erpnext`) routes to
 * `dispatchDomainCommand` with `erp_doc_kind` + a minted `idempotencyKey`.
 *
 * P2 procurement/company writes stay byte-for-byte on the direct DAL (re-assert the AC-ENA-001
 * invariant — P3a must not perturb P2).
 * The repository does not exist yet → RED.
 */

vi.mock('@/src/lib/adapterSeam/dispatchClient', () => ({
  dispatchDomainCommand: vi.fn(),
}));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({
  clearOwnershipCache: vi.fn(),
  setDomainOwnership: vi.fn(),
  routeDomainWrite: vi.fn(),
}));
vi.mock('@/src/lib/db/revenue', () => ({
  submitSalesInvoiceSod: vi.fn(),
  getSalesInvoice: vi.fn(),
  getIncomingPayment: vi.fn(),
}));

import * as dispatchClient from '@/src/lib/adapterSeam/dispatchClient';
import * as revenueDb from '@/src/lib/db/revenue';
import { clearOwnershipCache, setDomainOwnership, routeDomainWrite } from '@/src/lib/adapterSeam/ownershipCache';
import { repositories } from '@/src/lib/repositories';
import { AppError } from '@/src/lib/appError';

// The single spy target for every "must never dispatch externally" assertion below.
// On a cold ownership map every write in this file must leave this spy uncalled (AC-SAR-001).
// `as never` — `dispatchDomainCommand` is the target we spy on.
let dispatchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  clearOwnershipCache();
  dispatchSpy = vi.spyOn(dispatchClient, 'dispatchDomainCommand');
  // Default routeDomainWrite to 'pmo' (cold map) unless a test overrides it
  vi.mocked(routeDomainWrite).mockReturnValue('pmo');
});

describe('AC-SAR-001 cold ownership map — revenue writes are rejected with revenue-not-enabled', () => {
  it('AC-SAR-001 createInvoice is rejected with revenue-not-enabled and never dispatches', async () => {
    await expect(
      repositories.revenue.createInvoice({
        customerId: 'cust-1',
        projectId: 'proj-1',
        items: [{ item_code: 'ITEM-001', qty: 1, rate: 100 }],
      }),
    ).rejects.toBeInstanceOf(AppError);

    await expect(
      repositories.revenue.createInvoice({
        customerId: 'cust-1',
        projectId: 'proj-1',
        items: [{ item_code: 'ITEM-001', qty: 1, rate: 100 }],
      }),
    ).rejects.toMatchObject({ code: 'revenue-not-enabled' });

    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('AC-SAR-001 createPayment is rejected with revenue-not-enabled and never dispatches', async () => {
    await expect(
      repositories.revenue.createPayment({
        customerId: 'cust-1',
        salesInvoiceId: 'si-1',
        paidAmount: 100,
        receivedAmount: 100,
        date: '2026-07-14',
      }),
    ).rejects.toBeInstanceOf(AppError);

    await expect(
      repositories.revenue.createPayment({
        customerId: 'cust-1',
        salesInvoiceId: 'si-1',
        paidAmount: 100,
        receivedAmount: 100,
        date: '2026-07-14',
      }),
    ).rejects.toMatchObject({ code: 'revenue-not-enabled' });

    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('AC-SAR-001 submitInvoice is rejected with revenue-not-enabled and never dispatches', async () => {
    await expect(repositories.revenue.submitInvoice('si-1')).rejects.toMatchObject({
      code: 'revenue-not-enabled',
    });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('AC-SAR-001 cancelInvoice is rejected with revenue-not-enabled and never dispatches', async () => {
    await expect(repositories.revenue.cancelInvoice('si-1')).rejects.toMatchObject({
      code: 'revenue-not-enabled',
    });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('AC-SAR-001 cancelPayment is rejected with revenue-not-enabled and never dispatches', async () => {
    await expect(repositories.revenue.cancelPayment('ip-1')).rejects.toMatchObject({
      code: 'revenue-not-enabled',
    });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});

describe('AC-SAR-001 cold ownership map — P2 procurement/company writes stay byte-for-byte on direct DAL', () => {
  // These re-assert the AC-ENA-001 invariant — P3a must not perturb P2.
  // The actual procurement/company DAL mocks are in index.test.ts; here we just verify
  // the repositories object exports the procurement/company repositories (structural check).
  it('repositories.procurement exists (structural — P2 unchanged)', () => {
    expect(repositories.procurement).toBeDefined();
    expect(typeof repositories.procurement.createPurchaseOrder).toBe('function');
  });

  it('repositories.company exists (structural — P2 unchanged)', () => {
    expect(repositories.company).toBeDefined();
    expect(typeof repositories.company.create).toBe('function');
  });
});

/**
 * Task 2.8 (the OTHER half of AC-SAR-001) — a FLIPPED ownership map ('revenue'->'erpnext')
 * routes the record creates to `dispatchDomainCommand`, each carrying its `erp_doc_kind`
 * + a minted `idempotencyKey` (never a bare DAL call). Non-flipped stays byte-for-byte
 * (proven above) — this is the routing guard the test needs.
 */
describe('task 2.2 — flipped ownership map — revenue record creates route to dispatchDomainCommand', () => {
  beforeEach(() => {
    setDomainOwnership([{ domain: 'revenue', externalTier: 'erpnext' }]);
    vi.mocked(routeDomainWrite).mockReturnValue('external');
    // Mock getSalesInvoice and getIncomingPayment to return ERP external IDs
    vi.mocked(revenueDb.getSalesInvoice).mockResolvedValue({ si_number: 'ACC-SINV-2026-00001' } as any);
    vi.mocked(revenueDb.getIncomingPayment).mockResolvedValue({ ip_number: 'ACC-PE-REC-2026-00001' } as any);
  });

  afterEach(() => {
    clearOwnershipCache();
    vi.mocked(routeDomainWrite).mockReturnValue('pmo');
  });

  it('createInvoice dispatches externally with erp_doc_kind=sales-invoice + a minted idempotencyKey', async () => {
    dispatchSpy.mockResolvedValue({
      externalRecordId: 'ACC-SINV-2026-00001',
      canonical: { id: 'pmo-1', si_number: 'ACC-SINV-2026-00001' },
    });

    const result = await repositories.revenue.createInvoice({
      customerId: 'cust-1',
      projectId: 'proj-1',
      items: [{ item_code: 'ITEM-001', qty: 1, rate: 100 }],
    });

    expect(dispatchSpy).toHaveBeenCalledWith(
      'revenue',
      'create',
      expect.objectContaining({
        customerId: 'cust-1',
        projectId: 'proj-1',
        items: [{ item_code: 'ITEM-001', qty: 1, rate: 100 }],
        erp_doc_kind: 'sales-invoice',
      }),
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(result).toMatchObject({ id: 'pmo-1', si_number: 'ACC-SINV-2026-00001' });
  });

  it('createPayment dispatches externally with erp_doc_kind=incoming-payment + a minted idempotencyKey', async () => {
    dispatchSpy.mockResolvedValue({
      externalRecordId: 'ACC-PE-REC-2026-00001',
      canonical: { id: 'pmo-1', ip_number: 'ACC-PE-REC-2026-00001' },
    });

    const result = await repositories.revenue.createPayment({
      customerId: 'cust-1',
      salesInvoiceId: 'si-1',
      paidAmount: 100,
      receivedAmount: 100,
      date: '2026-07-14',
    });

    expect(dispatchSpy).toHaveBeenCalledWith(
      'revenue',
      'create',
      expect.objectContaining({
        customerId: 'cust-1',
        salesInvoiceId: 'si-1',
        // Luna BLOCK 5: the repo maps the camelCase input to the snake_case command record the
        // dispatch/body/recovery-payload all read (paid_amount/received_amount, NOT paidAmount).
        paid_amount: 100,
        received_amount: 100,
        date: '2026-07-14',
        erp_doc_kind: 'incoming-payment',
      }),
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(result).toMatchObject({ id: 'pmo-1', ip_number: 'ACC-PE-REC-2026-00001' });
  });

  // Luna BLOCK 5 (MONEY-CRITICAL): the repo MUST map the camelCase createPayment input to the
  // snake_case command record the dispatch/body/recovery-payload read — else the real FE path sends
  // undefined paid_amount/received_amount + empty references, the body posts empty amounts, and the
  // recovery composite probe can't match (wrongly HELD).
  it('Luna BLOCK 5 — createPayment command record carries paid_amount/received_amount (snake_case) + resolves references downstream', async () => {
    dispatchSpy.mockResolvedValue({
      externalRecordId: 'ACC-PE-REC-2026-00001',
      canonical: { id: 'pmo-1', ip_number: 'ACC-PE-REC-2026-00001' },
    });

    await repositories.revenue.createPayment({
      customerId: 'cust-1',
      salesInvoiceId: 'si-1',
      paidAmount: 100,
      receivedAmount: 100,
      date: '2026-07-14',
    });

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const [, , record] = dispatchSpy.mock.calls[0];
    // The money amounts are present in snake_case (the body/recovery-payload read these).
    expect(record).toMatchObject({ paid_amount: 100, received_amount: 100 });
    // The buggy camelCase form is GONE (it never reached ERP before — undefined amounts).
    expect(record).not.toHaveProperty('paidAmount');
    expect(record).not.toHaveProperty('receivedAmount');
    // received_amount defaults to paid_amount when omitted (peReceiveToBody treats it as mandatory).
    await repositories.revenue.createPayment({ customerId: 'cust-1', paidAmount: 250, date: '2026-07-14' });
    const [, , record2] = dispatchSpy.mock.calls[1];
    expect(record2).toMatchObject({ paid_amount: 250, received_amount: 250 });
  });

  it('submitInvoice dispatches externally with erp_doc_kind=sales-invoice (transition)', async () => {
    dispatchSpy.mockResolvedValue({
      externalRecordId: 'ACC-SINV-2026-00001',
      canonical: { id: 'si-1', erp_docstatus: 1 },
    });

    await repositories.revenue.submitInvoice('si-1');

    expect(dispatchSpy).toHaveBeenCalledWith(
      'revenue',
      'transition',
      expect.objectContaining({ id: 'si-1', erp_doc_kind: 'sales-invoice' }),
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });

  it('cancelInvoice dispatches externally with erp_doc_kind=sales-invoice (transition)', async () => {
    dispatchSpy.mockResolvedValue({
      externalRecordId: 'ACC-SINV-2026-00001',
      canonical: { id: 'si-1', erp_docstatus: 2 },
    });

    await repositories.revenue.cancelInvoice('si-1');

    expect(dispatchSpy).toHaveBeenCalledWith(
      'revenue',
      'transition',
      expect.objectContaining({ id: 'si-1', erp_doc_kind: 'sales-invoice' }),
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });

  it('cancelPayment dispatches externally with erp_doc_kind=incoming-payment (transition)', async () => {
    dispatchSpy.mockResolvedValue({
      externalRecordId: 'ACC-PE-REC-2026-00001',
      canonical: { id: 'ip-1', erp_docstatus: 2 },
    });

    await repositories.revenue.cancelPayment('ip-1');

    expect(dispatchSpy).toHaveBeenCalledWith(
      'revenue',
      'transition',
      expect.objectContaining({ id: 'ip-1', erp_doc_kind: 'incoming-payment' }),
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });
});

/**
 * FIX 1 (MONEY-CRITICAL) — submitInvoice must call the SoD RPC BEFORE dispatch.
 * The SoD RPC (submit_sales_invoice) enforces approver ≠ author at the DB layer.
 * If it throws 42501 (self-approval), dispatch must NEVER be called.
 */
describe('FIX 1 — submitInvoice SoD gate (AC-SAR-195 / FR-SAR-195)', () => {
  beforeEach(() => {
    setDomainOwnership([{ domain: 'revenue', externalTier: 'erpnext' }]);
    vi.mocked(routeDomainWrite).mockReturnValue('external');
    // Mock getSalesInvoice to return ERP external ID for the transition
    vi.mocked(revenueDb.getSalesInvoice).mockResolvedValue({ si_number: 'ACC-SINV-2026-00001' } as any);
  });

  afterEach(() => {
    clearOwnershipCache();
    vi.mocked(routeDomainWrite).mockReturnValue('pmo');
  });

  it('submitInvoice calls submitSalesInvoiceSod RPC first, THEN dispatches transition', async () => {
    const sodSpy = vi.mocked(revenueDb.submitSalesInvoiceSod);
    
    dispatchSpy.mockResolvedValue({
      externalRecordId: 'ACC-SINV-2026-00001',
      canonical: { id: 'si-1', erp_docstatus: 1 },
    });

    await repositories.revenue.submitInvoice('si-1');

    // SoD RPC must be called first
    expect(sodSpy).toHaveBeenCalledWith('si-1');
    // Then dispatch must be called
    expect(dispatchSpy).toHaveBeenCalledWith(
      'revenue',
      'transition',
      expect.objectContaining({ id: 'si-1', erp_doc_kind: 'sales-invoice' }),
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    // Verify order: SOD RPC called before dispatch
    expect(sodSpy).toHaveBeenCalledBefore(dispatchSpy);
  });

  it('submitInvoice rejects and NEVER dispatches when SoD RPC throws 42501 (self-approval)', async () => {
    const sodSpy = vi.mocked(revenueDb.submitSalesInvoiceSod);
    
    // Simulate the 42501 SoD error (self-approval attempt)
    const sodError = Object.assign(new Error('approver must differ from author (SoD)'), { code: '42501' });
    sodSpy.mockRejectedValueOnce(sodError);

    await expect(repositories.revenue.submitInvoice('si-1')).rejects.toMatchObject({ code: '42501' });

    // Dispatch must NEVER be called when SoD fails
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});