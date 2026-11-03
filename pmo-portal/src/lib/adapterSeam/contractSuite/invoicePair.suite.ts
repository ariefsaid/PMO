/**
 * invoice.pair-existing (v1) — an ERP invoice brought into PMO must carry the keys `propose_invoice_pairs` joins on
 * (ECA-5, AC-ECA-030; pairing itself is SQL and tier-agnostic, PD-ECA-10): the customer, the client's reference (or the
 * ERP's own number), the TAX-INCLUSIVE total as a two-decimal string, and the invoice date. The total must be the
 * grand total: a mapper that returned the net would never match the PMO copy's gross.
 */
import { describe, expect, it } from 'vitest';
import type { ErpHarness, InboundInvoiceDoc, Suite } from './harness.ts';

const DOC: InboundInvoiceDoc = {
  client: 'Acme Co', number: 'ACC-SINV-2026-00007', poRef: 'PO-7', total: '11100.00', taxAmount: '1100.00', date: '2026-03-20', currency: 'IDR',
};

function mapperOf(h: ErpHarness): NonNullable<ErpHarness['mapInboundInvoice']> {
  if (!h.mapInboundInvoice) throw new Error(`${h.tier} declares invoice.pair-existing supported but its harness has no mapInboundInvoice()`);
  return h.mapInboundInvoice.bind(h);
}

export const invoicePairSuite: Suite = (h) => describe(`invoice.pair-existing (${h.tier})`, () => {
  it('AC-ECA-030 the inbound invoice names its customer, so the feed can resolve customer_id', async () => {
    const row = await mapperOf(h)(DOC);
    expect(row.customer).toBe('Acme Co');
  });

  it('AC-ECA-030 the inbound invoice carries the client reference and its own number, the keys a pair matches on', async () => {
    const row = await mapperOf(h)(DOC);
    expect(row.reference_number).toBe('PO-7');
    expect(row.si_number).toBe('ACC-SINV-2026-00007');
  });

  it('AC-ECA-030 the amount is the tax-inclusive total as a two-decimal string, with its tax beside it', async () => {
    const row = await mapperOf(h)(DOC);
    expect(row.amount).toBe('11100.00');
    expect(row.tax_amount).toBe('1100.00');
    expect(row.currency).toBe('IDR');
  });

  it('AC-ECA-030 the invoice date is the ERP posting date, so the month can be compared', async () => {
    const row = await mapperOf(h)(DOC);
    expect(row.invoice_date).toBe('2026-03-20');
  });

  it('AC-ECA-030 an invoice without a client reference still carries its own number to match on', async () => {
    const row = await mapperOf(h)({ ...DOC, poRef: null });
    expect(row.reference_number).toBeNull();
    expect(row.si_number).toBe('ACC-SINV-2026-00007');
  });
});
