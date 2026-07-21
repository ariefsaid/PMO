import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * BLOCK 2 (MONEY-CRITICAL) — the idempotency key must identify the INTENT, not the ATTEMPT.
 *
 * The shipped repository minted `{ id: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() }`
 * INSIDE every write method, so a human retry after a lost response ("external system unreachable —
 * try again", `adapterSeam/pendingPush.ts`) produced a DIFFERENT outbox 4-tuple: no claim contention,
 * no anchor-probe hit (the in-flight ERP doc carries the FIRST key), therefore an immediate second
 * POST → two SUBMITTED money documents. The outbox only ever de-duplicated retries that REUSE the key.
 *
 * The seam proven here: every externally-routed write ACCEPTS a caller-supplied `CommandIntent`
 * (`{ id, idempotencyKey }`, minted ONCE per form/mutation session by `newCommandIntent()`) and uses
 * it VERBATIM on every attempt, so a retry lands on the SAME outbox row and reconciles (adopting the
 * committed doc) instead of re-POSTing. Omitting it keeps the pre-existing per-call minting
 * (byte-for-byte for every caller that has not been threaded yet).
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
import { routeDomainWrite } from '@/src/lib/adapterSeam/ownershipCache';
import { repositories, newCommandIntent } from '@/src/lib/repositories';

const dispatchSpy = vi.mocked(dispatchClient.dispatchDomainCommand);

/** The (record, options) pair of the Nth dispatch call. */
function callIdentity(n: number): { id: unknown; idempotencyKey: unknown } {
  const [, , record, options] = dispatchSpy.mock.calls[n] as unknown as [
    string,
    string,
    Record<string, unknown>,
    { idempotencyKey?: string } | undefined,
  ];
  return { id: record.id, idempotencyKey: options?.idempotencyKey };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(routeDomainWrite).mockReturnValue('external');
  vi.mocked(revenueDb.getSalesInvoice).mockResolvedValue({
    si_number: 'ACC-SINV-2026-00001',
  } as unknown as Awaited<ReturnType<typeof revenueDb.getSalesInvoice>>);
  vi.mocked(revenueDb.getIncomingPayment).mockResolvedValue({
    ip_number: 'ACC-PE-REC-2026-00001',
  } as unknown as Awaited<ReturnType<typeof revenueDb.getIncomingPayment>>);
  dispatchSpy.mockResolvedValue({
    externalRecordId: 'ACC-SINV-2026-00001',
    canonical: { id: 'pmo-1', si_number: 'ACC-SINV-2026-00001', ip_number: 'ACC-PE-REC-2026-00001' },
  });
});

describe('newCommandIntent', () => {
  it('mints a distinct { id, idempotencyKey } pair per intent', () => {
    const a = newCommandIntent();
    const b = newCommandIntent();
    expect(a.id).toEqual(expect.any(String));
    expect(a.idempotencyKey).toEqual(expect.any(String));
    expect(a.id).not.toEqual(a.idempotencyKey);
    expect(a.id).not.toEqual(b.id);
    expect(a.idempotencyKey).not.toEqual(b.idempotencyKey);
  });
});

describe('BLOCK 2 — a retry under the SAME intent reuses the outbox 4-tuple (never a second POST)', () => {
  it('revenue.createPayment reuses the caller-supplied id + idempotencyKey on every attempt', async () => {
    const intent = newCommandIntent();
    const input = { customerId: 'cust-1', salesInvoiceId: 'si-1', paidAmount: 100, date: '2026-07-20' };

    // Attempt 1: ERP commits, the response is lost → the caller sees `external-unreachable`.
    dispatchSpy.mockRejectedValueOnce(new Error('external system unreachable — try again'));
    await expect(repositories.revenue.createPayment(input, intent)).rejects.toThrow();
    // Attempt 2: the human clicks "Receive Payment" again — SAME intent.
    await repositories.revenue.createPayment(input, intent);

    expect(dispatchSpy).toHaveBeenCalledTimes(2);
    expect(callIdentity(0)).toEqual({ id: intent.id, idempotencyKey: intent.idempotencyKey });
    expect(callIdentity(1)).toEqual(callIdentity(0));
  });

  it('revenue.createInvoice reuses the caller-supplied id + idempotencyKey on every attempt', async () => {
    const intent = newCommandIntent();
    const input = { customerId: 'cust-1', items: [{ item_code: 'ITEM-001', qty: 1, rate: 100 }] };

    await repositories.revenue.createInvoice(input, intent);
    await repositories.revenue.createInvoice(input, intent);

    expect(callIdentity(0)).toEqual({ id: intent.id, idempotencyKey: intent.idempotencyKey });
    expect(callIdentity(1)).toEqual(callIdentity(0));
  });

  it('procurement.createInvoice (Purchase Invoice) reuses the caller-supplied intent', async () => {
    const intent = newCommandIntent();

    await repositories.procurement.createInvoice('proc-1', 'Received', '2026-07-20', null, null, intent);
    await repositories.procurement.createInvoice('proc-1', 'Received', '2026-07-20', null, null, intent);

    expect(callIdentity(0)).toEqual({ id: intent.id, idempotencyKey: intent.idempotencyKey });
    expect(callIdentity(1)).toEqual(callIdentity(0));
  });

  it('procurement.createPayment (Payment Entry) reuses the caller-supplied intent', async () => {
    const intent = newCommandIntent();

    await repositories.procurement.createPayment('proc-1', 'inv-1', null, null, '2026-07-20', 100, intent);
    await repositories.procurement.createPayment('proc-1', 'inv-1', null, null, '2026-07-20', 100, intent);

    expect(callIdentity(0)).toEqual({ id: intent.id, idempotencyKey: intent.idempotencyKey });
    expect(callIdentity(1)).toEqual(callIdentity(0));
  });

  it('a transition (cancelInvoice) reuses the caller-supplied idempotencyKey, keeping the record id', async () => {
    const intent = newCommandIntent();

    await repositories.revenue.cancelInvoice('si-1', intent);
    await repositories.revenue.cancelInvoice('si-1', intent);

    // The record id of a transition is the EXISTING record, not the intent's minted id.
    expect(callIdentity(0)).toEqual({ id: 'si-1', idempotencyKey: intent.idempotencyKey });
    expect(callIdentity(1)).toEqual(callIdentity(0));
  });

  it('submitInvoice reuses the caller-supplied idempotencyKey', async () => {
    const intent = newCommandIntent();

    await repositories.revenue.submitInvoice('si-1', intent);
    await repositories.revenue.submitInvoice('si-1', intent);

    expect(callIdentity(0)).toEqual({ id: 'si-1', idempotencyKey: intent.idempotencyKey });
    expect(callIdentity(1)).toEqual(callIdentity(0));
  });
});

describe('BLOCK 2 — omitting the intent keeps the pre-existing per-call minting', () => {
  it('two intent-less createPayment calls mint distinct ids AND distinct keys', async () => {
    const input = { customerId: 'cust-1', paidAmount: 100, date: '2026-07-20' };
    await repositories.revenue.createPayment(input);
    await repositories.revenue.createPayment(input);

    const first = callIdentity(0);
    const second = callIdentity(1);
    expect(first.id).toEqual(expect.any(String));
    expect(first.idempotencyKey).toEqual(expect.any(String));
    expect(second.id).not.toEqual(first.id);
    expect(second.idempotencyKey).not.toEqual(first.idempotencyKey);
  });
});
