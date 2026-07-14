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

import * as dispatchClient from '@/src/lib/adapterSeam/dispatchClient';
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
        paidAmount: 100,
        receivedAmount: 100,
        date: '2026-07-14',
        erp_doc_kind: 'incoming-payment',
      }),
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(result).toMatchObject({ id: 'pmo-1', ip_number: 'ACC-PE-REC-2026-00001' });
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