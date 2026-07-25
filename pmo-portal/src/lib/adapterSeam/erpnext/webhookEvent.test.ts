/**
 * AC-SAR-062 — erpnext/webhookEvent.ts: inbound feed events for revenue kinds decode with correct
 * kind/domain via kindFromDoctypeAndPaymentType (Payment Entry disambiguation). Sales Invoice
 * decodes via unique doctype.
 */
import { describe, expect, it } from 'vitest';
import { decodeErpWebhookEvent } from './webhookEvent.ts';

describe('erpnext/webhookEvent — revenue kinds decode (AC-SAR-062)', () => {
  const basePayload = {
    doctype: 'Payment Entry',
    name: 'PE-REC-001',
    docstatus: 1,
    amended_from: null,
    modified: '2026-07-12 12:00:00.000000',
    doc: { name: 'PE-REC-001', party_type: 'Customer', party: 'Customer A', payment_type: 'Receive', paid_amount: '50000' },
  };

  it('Payment Entry with payment_type=Receive → incoming-payment (revenue)', () => {
    const event = decodeErpWebhookEvent({ ...basePayload, doc: { ...basePayload.doc, payment_type: 'Receive' } });
    expect(event).not.toBeNull();
    expect(event!.kind).toBe('incoming-payment');
    expect(event!.domain).toBe('revenue');
    expect(event!.externalRecordId).toBe('PE-REC-001');
  });

  it('Payment Entry with payment_type=Pay → payment (procurement)', () => {
    const event = decodeErpWebhookEvent({ ...basePayload, doc: { ...basePayload.doc, payment_type: 'Pay', party_type: 'Supplier' } });
    expect(event).not.toBeNull();
    expect(event!.kind).toBe('payment');
    expect(event!.domain).toBe('procurement');
  });

  it('Payment Entry with unknown payment_type → undefined (ack-and-skip)', () => {
    const event = decodeErpWebhookEvent({ ...basePayload, doc: { ...basePayload.doc, payment_type: 'Unknown' } });
    expect(event).not.toBeNull();
    expect(event!.kind).toBeUndefined();
    expect(event!.domain).toBeUndefined();
  });

  it('Payment Entry with missing payment_type → undefined (ack-and-skip)', () => {
    const event = decodeErpWebhookEvent({ ...basePayload, doc: { ...basePayload.doc, payment_type: undefined } });
    expect(event).not.toBeNull();
    expect(event!.kind).toBeUndefined();
    expect(event!.domain).toBeUndefined();
  });

  it('Sales Invoice (unique doctype) → sales-invoice (revenue)', () => {
    const event = decodeErpWebhookEvent({
      doctype: 'Sales Invoice',
      name: 'SINV-001',
      docstatus: 1,
      amended_from: null,
      modified: '2026-07-12 12:00:00.000000',
      doc: { name: 'SINV-001', customer: 'Customer A', grand_total: '100000' },
    });
    expect(event).not.toBeNull();
    expect(event!.kind).toBe('sales-invoice');
    expect(event!.domain).toBe('revenue');
    expect(event!.externalRecordId).toBe('SINV-001');
  });

  it('unmapped doctype → undefined kind/domain (ack-and-skip)', () => {
    const event = decodeErpWebhookEvent({
      doctype: 'Some Other DocType',
      name: 'X-001',
      docstatus: 1,
      modified: '2026-07-12 12:00:00.000000',
      doc: {},
    });
    expect(event).not.toBeNull();
    expect(event!.kind).toBeUndefined();
    expect(event!.domain).toBeUndefined();
  });

  it('malformed payload (no doctype/name) → null', () => {
    expect(decodeErpWebhookEvent({})).toBeNull();
    expect(decodeErpWebhookEvent({ doctype: 'Sales Invoice' })).toBeNull();
    expect(decodeErpWebhookEvent({ name: 'SINV-001' })).toBeNull();
  });
});