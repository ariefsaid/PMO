import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: mockRpc } }));

import { getProcurementPaymentCeiling, getProcurementAmountEligibility, approveProcurementAmount, attachPaymentCeiling } from './procurementPaymentCeiling';
import { AppError } from '@/src/lib/appError';

beforeEach(() => mockRpc.mockReset());

describe('getProcurementPaymentCeiling', () => {
  it('AC-SEC-220: reads the server ceiling for one procurement and maps it', async () => {
    mockRpc.mockResolvedValue({
      data: [{ ok: false, reason: 'vendor bill exceeds approved amount', billed_net: 1200, approved_amount: 1000 }],
      error: null,
    });
    await expect(getProcurementPaymentCeiling('proc-1')).resolves.toEqual({
      ok: false,
      reason: 'vendor bill exceeds approved amount',
      billedNet: 1200,
      approvedAmount: 1000,
    });
    expect(mockRpc).toHaveBeenCalledWith('procurement_payment_within_ceiling', { p_procurement_id: 'proc-1' });
  });

  it('AC-SEC-220: returns null when the server returns no ceiling row', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    await expect(getProcurementPaymentCeiling('proc-1')).resolves.toBeNull();
  });

  it('AC-SEC-220: keeps nullable amounts as null rather than inventing zero', async () => {
    mockRpc.mockResolvedValue({
      data: [{ ok: false, reason: 'approved amount is missing', billed_net: 900, approved_amount: null }],
      error: null,
    });
    await expect(getProcurementPaymentCeiling('proc-1')).resolves.toMatchObject({ billedNet: 900, approvedAmount: null });
  });

  it('AC-SEC-220: surfaces a read error with its code', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom', code: '42501' } });
    await expect(getProcurementPaymentCeiling('proc-1')).rejects.toMatchObject({ name: 'AppError', code: '42501' });
  });
});

describe('getProcurementAmountEligibility', () => {
  it('returns the server decision for the amount presented to the user', async () => {
    mockRpc.mockResolvedValue({ data: 'bill_recorder', error: null });
    await expect(getProcurementAmountEligibility('proc-1', 1200)).resolves.toBe('bill_recorder');
    expect(mockRpc).toHaveBeenCalledWith('procurement_amount_eligibility', { p_procurement_id: 'proc-1', p_amount: 1200 });
  });
});

describe('approveProcurementAmount', () => {
  it('AC-SEC-220: sends the procurement id and the amount to the approval RPC', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await approveProcurementAmount('proc-1', 1200);
    expect(mockRpc).toHaveBeenCalledWith('approve_procurement_amount', { p_procurement_id: 'proc-1', p_amount: 1200 });
  });

  it('AC-SEC-220: preserves the server refusal code for a classified message', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'separation of duties: requester cannot approve the procurement amount', code: '42501' },
    });
    const err = await approveProcurementAmount('proc-1', 1200).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: '42501', message: 'separation of duties: requester cannot approve the procurement amount' });
  });
});

describe('attachPaymentCeiling', () => {
  it('AC-SEC-220: reads the ceiling only for a procurement awaiting payment', async () => {
    const detail = { id: 'proc-1', status: 'Ordered' };
    await expect(attachPaymentCeiling(detail)).resolves.toBe(detail);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('AC-SEC-220: attaches the ceiling to a Vendor Invoiced procurement', async () => {
    mockRpc.mockResolvedValue({ data: [{ ok: true, reason: null, billed_net: 900, approved_amount: 1000 }], error: null });
    await expect(attachPaymentCeiling({ id: 'proc-1', status: 'Vendor Invoiced' })).resolves.toEqual({
      id: 'proc-1',
      status: 'Vendor Invoiced',
      paymentCeiling: { ok: true, reason: null, billedNet: 900, approvedAmount: 1000 },
    });
  });

  it('attaches the decision for the actual billed overage', async () => {
    mockRpc.mockResolvedValueOnce({ data: [{ ok: false, reason: 'overage', billed_net: 1200, approved_amount: 1000 }], error: null });
    mockRpc.mockResolvedValueOnce({ data: 'bill_recorder', error: null });
    await expect(attachPaymentCeiling({ id: 'proc-1', status: 'Vendor Invoiced' })).resolves.toMatchObject({ paymentEligibility: 'bill_recorder' });
    expect(mockRpc).toHaveBeenLastCalledWith('procurement_amount_eligibility', { p_procurement_id: 'proc-1', p_amount: 1200 });
  });

  it('fails closed when the eligibility read fails', async () => {
    mockRpc.mockResolvedValueOnce({ data: [{ ok: false, reason: 'overage', billed_net: 1200, approved_amount: 1000 }], error: null });
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'unavailable' } });
    await expect(attachPaymentCeiling({ id: 'proc-1', status: 'Vendor Invoiced' })).resolves.toMatchObject({ paymentEligibility: null });
  });

  it('AC-SEC-220: an unreadable ceiling leaves the page readable with no ceiling (payment stays server-enforced)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(attachPaymentCeiling({ id: 'proc-1', status: 'Vendor Invoiced' })).resolves.toMatchObject({ paymentCeiling: null });
  });
});
