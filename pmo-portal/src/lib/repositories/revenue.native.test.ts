import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * #784 — the repository's PMO-native revenue path. While no ERP owns revenue (cold or 'pmo' route), every revenue
 * write goes to migration 0275's RPCs and NEVER dispatches to the ERP (the goal AC-SAR-001 always asserted). Once an
 * ERP owns revenue, a row raised in PMO before connect is history: it is never pushed (AC-NAR-004).
 */
vi.mock('@/src/lib/adapterSeam/dispatchClient', () => ({ dispatchDomainCommand: vi.fn() }));
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
vi.mock('@/src/lib/db/revenueNative', () => ({
  createNativeSalesInvoice: vi.fn(),
  transitionNativeSalesInvoice: vi.fn(),
  recordNativeReceipt: vi.fn(),
  cancelNativeReceipt: vi.fn(),
}));

import { dispatchDomainCommand } from '@/src/lib/adapterSeam/dispatchClient';
import { routeDomainWrite } from '@/src/lib/adapterSeam/ownershipCache';
import * as revenueDb from '@/src/lib/db/revenue';
import * as native from '@/src/lib/db/revenueNative';
import { repositories } from '@/src/lib/repositories';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(routeDomainWrite).mockReturnValue('pmo');
  vi.mocked(native.createNativeSalesInvoice).mockResolvedValue('si-native-1');
  vi.mocked(native.transitionNativeSalesInvoice).mockResolvedValue(undefined);
  vi.mocked(native.recordNativeReceipt).mockResolvedValue('ip-native-1');
  vi.mocked(native.cancelNativeReceipt).mockResolvedValue(undefined);
});

describe('no ERP owns revenue — writes take the PMO path and never dispatch (AC-SAR-001 goal kept)', () => {
  it('AC-NAR-001 createInvoice raises a PMO invoice with the typed lines and never dispatches', async () => {
    const items = [{ item_code: 'SVC', qty: 2, rate: 500000, description: 'Site survey' }];
    await expect(repositories.revenue.createInvoice({ customerId: 'c-1', projectId: 'p-1', items }))
      .resolves.toEqual({ id: 'si-native-1', si_number: null });
    expect(native.createNativeSalesInvoice).toHaveBeenCalledWith({ projectId: 'p-1', customerId: 'c-1', lines: items, workOrderId: null });
    expect(dispatchDomainCommand).not.toHaveBeenCalled();
  });
  it('AC-NAR-001 a PMO invoice without a project is refused before any write', async () => {
    await expect(repositories.revenue.createInvoice({ customerId: 'c-1', items: [{ item_code: 'SVC', qty: 1, rate: 1 }] }))
      .rejects.toMatchObject({ code: 'native-invoice-needs-project' });
    expect(native.createNativeSalesInvoice).not.toHaveBeenCalled();
    expect(dispatchDomainCommand).not.toHaveBeenCalled();
  });
  it('AC-NAR-002 submitInvoice approves in PMO and never dispatches', async () => {
    await repositories.revenue.submitInvoice('si-1');
    expect(native.transitionNativeSalesInvoice).toHaveBeenCalledWith('si-1', 'Unpaid');
    expect(revenueDb.submitSalesInvoiceSod).not.toHaveBeenCalled();
    expect(dispatchDomainCommand).not.toHaveBeenCalled();
  });
  it('AC-NAR-005 cancelInvoice cancels in PMO and never dispatches', async () => {
    await repositories.revenue.cancelInvoice('si-1');
    expect(native.transitionNativeSalesInvoice).toHaveBeenCalledWith('si-1', 'Cancelled');
    expect(dispatchDomainCommand).not.toHaveBeenCalled();
  });
  it('AC-NAR-003 createPayment records a PMO receipt against the invoice', async () => {
    await expect(repositories.revenue.createPayment({ customerId: 'c-1', salesInvoiceId: 'si-1', paidAmount: 610000, receivedAmount: 600000, withheldAmount: 10000, withholdingSlipNumber: 'BP-1', date: '2026-10-07' }))
      .resolves.toEqual({ id: 'ip-native-1', ip_number: null });
    expect(native.recordNativeReceipt).toHaveBeenCalledWith({ salesInvoiceId: 'si-1', amount: 610000, receivedAmount: 600000, withheldAmount: 10000, withholdingSlipNumber: 'BP-1', date: '2026-10-07' });
    expect(dispatchDomainCommand).not.toHaveBeenCalled();
  });
  it('AC-NAR-003 (DD-NAR-17) an amount with no cash/withheld split sends no client-computed split — the server defaults it', async () => {
    await repositories.revenue.createPayment({ customerId: 'c-1', salesInvoiceId: 'si-1', paidAmount: 610000.1, date: '2026-10-07' });
    expect(native.recordNativeReceipt).toHaveBeenCalledWith({ salesInvoiceId: 'si-1', amount: 610000.1, date: '2026-10-07' });
  });
  it('AC-NAR-003 a PMO receipt must name its invoice', async () => {
    await expect(repositories.revenue.createPayment({ customerId: 'c-1', salesInvoiceId: null, paidAmount: 1, receivedAmount: 1, date: '2026-10-07' }))
      .rejects.toMatchObject({ code: 'native-receipt-needs-invoice' });
    expect(native.recordNativeReceipt).not.toHaveBeenCalled();
  });
  it('AC-NAR-006 cancelPayment cancels a PMO receipt and never dispatches', async () => {
    await repositories.revenue.cancelPayment('ip-1');
    expect(native.cancelNativeReceipt).toHaveBeenCalledWith('ip-1');
    expect(dispatchDomainCommand).not.toHaveBeenCalled();
  });
});

describe('an ERP owns revenue — a PMO row from before connect is never pushed (AC-NAR-004)', () => {
  beforeEach(() => {
    vi.mocked(routeDomainWrite).mockReturnValue('external');
    vi.mocked(revenueDb.getSalesInvoice).mockResolvedValue({ si_number: null, pmo_native: true } as unknown as Awaited<ReturnType<typeof revenueDb.getSalesInvoice>>);
    vi.mocked(revenueDb.getIncomingPayment).mockResolvedValue({ ip_number: null, pmo_native: true } as unknown as Awaited<ReturnType<typeof revenueDb.getIncomingPayment>>);
  });
  it('AC-NAR-004 submitInvoice on a PMO invoice is refused and never dispatched', async () => {
    await expect(repositories.revenue.submitInvoice('si-1')).rejects.toMatchObject({ code: 'native-revenue-read-only' });
    expect(dispatchDomainCommand).not.toHaveBeenCalled();
  });
  it('AC-NAR-004 a PMO invoice is refused as read-only BEFORE the ERP SoD check runs', async () => {
    await expect(repositories.revenue.submitInvoice('si-1')).rejects.toMatchObject({ code: 'native-revenue-read-only' });
    expect(revenueDb.submitSalesInvoiceSod).not.toHaveBeenCalled();
  });
  it('AC-NAR-004 cancelInvoice on a PMO invoice is refused and never dispatched', async () => {
    await expect(repositories.revenue.cancelInvoice('si-1')).rejects.toMatchObject({ code: 'native-revenue-read-only' });
    expect(dispatchDomainCommand).not.toHaveBeenCalled();
  });
  it('AC-NAR-004 cancelPayment on a PMO receipt is refused and never dispatched', async () => {
    await expect(repositories.revenue.cancelPayment('ip-1')).rejects.toMatchObject({ code: 'native-revenue-read-only' });
    expect(dispatchDomainCommand).not.toHaveBeenCalled();
  });
  it('AC-NAR-004 the PMO path is never called once an ERP owns revenue', async () => {
    await repositories.revenue.submitInvoice('si-1').catch(() => undefined);
    expect(native.transitionNativeSalesInvoice).not.toHaveBeenCalled();
  });
});
