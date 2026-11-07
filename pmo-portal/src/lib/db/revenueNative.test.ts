import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));

import {
  NATIVE_REVENUE_REFUSALS, applyNativeReceipt, cancelNativeReceipt, createNativeSalesInvoice, recordNativeOnAccountReceipt,
  recordNativeReceipt, transitionNativeSalesInvoice, unapplyNativeAllocation,
} from './revenueNative';
import { AppError } from '@/src/lib/appError';

beforeEach(() => {
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: 'new-id', error: null });
});

describe('revenueNative DAL (#784) — names the four RPCs and sends what the user entered', () => {
  it('AC-NAR-001 raises an invoice with its project, customer, lines and work order', async () => {
    const lines = [{ item_code: 'SVC', qty: 2, rate: 500000, description: 'Site survey' }];
    await expect(createNativeSalesInvoice({ projectId: 'p-1', customerId: 'c-1', lines, workOrderId: 'wo-1' })).resolves.toBe('new-id');
    expect(h.rpc).toHaveBeenCalledWith('create_native_sales_invoice', {
      p_project_id: 'p-1', p_customer_id: 'c-1', p_lines: lines, p_work_order_id: 'wo-1',
    });
  });
  it('AC-NAR-001 sends no work order when there is none', async () => {
    await createNativeSalesInvoice({ projectId: 'p-1', customerId: 'c-1', lines: [{ item_code: 'SVC', qty: 1, rate: 1 }], workOrderId: null });
    expect(h.rpc.mock.calls[0][1]).not.toHaveProperty('p_work_order_id');
  });
  it('FR-003 sends the billing kind to create_native_sales_invoice when chosen, and nothing when omitted', async () => {
    const lines = [{ item_code: 'SVC', qty: 1, rate: 1 }];
    await createNativeSalesInvoice({ projectId: 'p-1', customerId: 'c-1', lines, billingKind: 'other' });
    expect(h.rpc.mock.calls[0][1]).toMatchObject({ p_billing_kind: 'other' });
    h.rpc.mockClear();
    await createNativeSalesInvoice({ projectId: 'p-1', customerId: 'c-1', lines });
    expect(h.rpc.mock.calls[0][1]).not.toHaveProperty('p_billing_kind');
  });
  it('AC-NAR-002 approves (Unpaid) and AC-NAR-005 cancels through the one transition RPC', async () => {
    await transitionNativeSalesInvoice('si-1', 'Unpaid');
    await transitionNativeSalesInvoice('si-1', 'Cancelled');
    expect(h.rpc).toHaveBeenNthCalledWith(1, 'transition_native_sales_invoice', { p_id: 'si-1', p_to: 'Unpaid' });
    expect(h.rpc).toHaveBeenNthCalledWith(2, 'transition_native_sales_invoice', { p_id: 'si-1', p_to: 'Cancelled' });
  });
  it('AC-NAR-003 records a receipt with the payment date, settled, cash and withheld amounts and the slip', async () => {
    await expect(recordNativeReceipt({ salesInvoiceId: 'si-1', amount: 610000, receivedAmount: 600000, withheldAmount: 10000, withholdingSlipNumber: ' BP-1 ', date: '2026-10-07' })).resolves.toBe('new-id');
    expect(h.rpc).toHaveBeenCalledWith('record_native_receipt', {
      p_sales_invoice_id: 'si-1', p_amount: 610000, p_received_amount: 600000, p_withheld_amount: 10000,
      p_withholding_slip_number: 'BP-1', p_date: '2026-10-07',
    });
  });
  it('AC-NAR-003 (DD-NAR-17) the payment date is ALWAYS sent; no amount lets the server settle the balance', async () => {
    await recordNativeReceipt({ salesInvoiceId: 'si-1', date: '2026-10-01' });
    expect(h.rpc).toHaveBeenCalledWith('record_native_receipt', { p_sales_invoice_id: 'si-1', p_date: '2026-10-01' });
  });
  it('AC-NAR-006 cancels a receipt by id', async () => {
    await cancelNativeReceipt('ip-1');
    expect(h.rpc).toHaveBeenCalledWith('cancel_native_receipt', { p_receipt_id: 'ip-1' });
  });
  it('AC-NAR-002 a server refusal reaches the caller with its SQLSTATE', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'approver must differ from author (SoD)', code: '42501' } });
    const err = await transitionNativeSalesInvoice('si-1', 'Unpaid').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: '42501' });
  });
  it('AC-NAR-003 every writer surfaces a refusal (create, receipt, receipt cancel)', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'the payment date cannot be in the future', code: '23514' } });
    await expect(recordNativeReceipt({ salesInvoiceId: 'si-1', date: '2099-01-01' })).rejects.toMatchObject({ code: '23514' });
    await expect(createNativeSalesInvoice({ projectId: 'p', customerId: 'c', lines: [] })).rejects.toBeInstanceOf(AppError);
    await expect(cancelNativeReceipt('ip-1')).rejects.toBeInstanceOf(AppError);
  });
  it('#784 the final refusal codes from migration 0275 and #1415 migration 0731 are all known (31)', () => {
    expect(NATIVE_REVENUE_REFUSALS).toHaveLength(31);
    expect(NATIVE_REVENUE_REFUSALS).toEqual(expect.arrayContaining([
      'pmo-native', 'receipt-split-mismatch', 'sod-self-approval', 'illegal-transition',
      'allocation-exceeds-unapplied', 'allocation-exceeds-balance', 'allocation-amount-invalid', 'allocation-duplicate-invoice',
      'allocation-client-mismatch', 'allocation-currency-mismatch', 'allocation-already-reversed', 'receipt-not-applicable',
      'request-id-reused',
    ]));
  });
  it('#784 a refusal carrying a machine-readable detail reaches the caller keyed on that detail, not the SQLSTATE', async () => {
    for (const detail of NATIVE_REVENUE_REFUSALS) {
      h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'refused', code: '23514', details: detail } });
      await expect(recordNativeReceipt({ salesInvoiceId: 'si-1', date: '2026-10-07' })).rejects.toMatchObject({ code: detail, message: 'refused' });
    }
  });
  it('#784 an unknown detail never becomes the code — the SQLSTATE stays', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'refused', code: '23514', details: 'Failing row contains (secret)' } });
    await expect(createNativeSalesInvoice({ projectId: 'p', customerId: 'c', lines: [{ item_code: 'S', qty: 1, rate: 1 }] })).rejects.toMatchObject({ code: '23514' });
  });
  it('#784 a write that returns no id is an error, never the string "null"', async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    await expect(createNativeSalesInvoice({ projectId: 'p', customerId: 'c', lines: [{ item_code: 'S', qty: 1, rate: 1 }] })).rejects.toBeInstanceOf(AppError);
    await expect(recordNativeReceipt({ salesInvoiceId: 'si-1', date: '2026-10-07' })).rejects.toBeInstanceOf(AppError);
  });
});

describe('revenueNative DAL (#1415) — apply a receipt to invoices', () => {
  it('AC-NPA-001 records an on-account receipt with the id minted by the caller (the replay key) and no invoice', async () => {
    await expect(recordNativeOnAccountReceipt({
      customerId: 'c-1', amount: 100, receivedAmount: 90, withheldAmount: 10, withholdingSlipNumber: ' BP-9 ', date: '2026-10-07', receiptId: 'rc-1',
    })).resolves.toBe('new-id');
    expect(h.rpc).toHaveBeenCalledWith('record_native_on_account_receipt', {
      p_customer_id: 'c-1', p_amount: 100, p_received_amount: 90, p_withheld_amount: 10,
      p_withholding_slip_number: 'BP-9', p_date: '2026-10-07', p_receipt_id: 'rc-1',
    });
  });
  it('AC-NPA-001 sends only what was entered: no received/withheld/slip when omitted', async () => {
    await recordNativeOnAccountReceipt({ customerId: 'c-1', amount: 100, date: '2026-10-07', receiptId: 'rc-1' });
    expect(h.rpc).toHaveBeenCalledWith('record_native_on_account_receipt', {
      p_customer_id: 'c-1', p_amount: 100, p_date: '2026-10-07', p_receipt_id: 'rc-1',
    });
  });
  it('AC-NPA-002 applies a receipt across invoices in one call, with the request id that makes a retry safe', async () => {
    h.rpc.mockResolvedValue({ data: ['al-1', 'al-2'], error: null });
    await expect(applyNativeReceipt({
      receiptId: 'rc-1', requestId: 'rq-1',
      allocations: [{ invoiceId: 'si-1', amount: 60 }, { invoiceId: 'si-2', amount: 40 }],
    })).resolves.toEqual(['al-1', 'al-2']);
    expect(h.rpc).toHaveBeenCalledWith('apply_native_receipt', {
      p_receipt_id: 'rc-1', p_request_id: 'rq-1',
      p_allocations: [{ invoice_id: 'si-1', amount: 60 }, { invoice_id: 'si-2', amount: 40 }],
    });
  });
  it('AC-NPA-002 an apply that reports success with no ids is an error, never an empty success', async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    await expect(applyNativeReceipt({ receiptId: 'rc-1', requestId: 'rq-1', allocations: [{ invoiceId: 'si-1', amount: 1 }] })).rejects.toBeInstanceOf(AppError);
  });
  it('AC-NPA-007 unapplies one allocation by id', async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    await unapplyNativeAllocation('al-1');
    expect(h.rpc).toHaveBeenCalledWith('unapply_native_allocation', { p_allocation_id: 'al-1' });
  });
  it('AC-NPA-012 a refusal reaches the caller keyed on its stable detail code, from each of the three writers', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'more than the receipt has left to apply', code: '23514', details: 'allocation-exceeds-unapplied' } });
    await expect(applyNativeReceipt({ receiptId: 'rc-1', requestId: 'rq-1', allocations: [{ invoiceId: 'si-1', amount: 1 }] }))
      .rejects.toMatchObject({ code: 'allocation-exceeds-unapplied' });
    h.rpc.mockResolvedValue({ data: null, error: { message: 'this allocation is already reversed', code: 'P0001', details: 'allocation-already-reversed' } });
    await expect(unapplyNativeAllocation('al-1')).rejects.toMatchObject({ code: 'allocation-already-reversed' });
    h.rpc.mockResolvedValue({ data: null, error: { message: 'x', code: 'P0001', details: 'request-id-reused' } });
    await expect(recordNativeOnAccountReceipt({ customerId: 'c-1', amount: 1, date: '2026-10-07', receiptId: 'rc-1' }))
      .rejects.toMatchObject({ code: 'request-id-reused' });
  });
});
