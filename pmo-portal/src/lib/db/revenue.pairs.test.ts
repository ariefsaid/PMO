/**
 * db/revenue.ts — invoice pairing reads and the accept (ECA-5, AC-ECA-030). The server RPCs are the authority (pgTAP
 * invoice_pairs.test.sql); these tests pin the wire shape and the error mapping the review screen relies on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  pages: [] as Array<Array<Record<string, unknown>>>,
  isCalls: [] as Array<[string, unknown]>,
  notCalls: [] as Array<[string, string, unknown]>,
}));
vi.mock('@/src/lib/supabase/client', () => ({
  supabase: {
    rpc: h.rpc,
    from: () => {
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b,
        not: (c: string, op: string, v: unknown) => { h.notCalls.push([c, op, v]); return b; },
        order: () => b,
        range: () => b,
        then: (resolve: (v: { data: unknown; error: null }) => unknown) => resolve({ data: h.pages.shift() ?? [], error: null }),
      });
      return b;
    },
  },
}));

import { proposeInvoicePairs, acceptInvoicePairs, listUnpairedNativeInvoices, listAcceptedInvoicePairs } from './revenue';

beforeEach(() => { h.rpc.mockReset(); h.pages = []; h.notCalls = []; });

describe('invoice pairing DAL (ECA-5)', () => {
  it('AC-ECA-030 proposeInvoicePairs maps the proposal rows and keeps the ambiguous flag', async () => {
    h.rpc.mockResolvedValue({
      data: [
        { pmo_invoice_id: 'n1', erp_invoice_id: 'e1', ambiguous: false, pmo_number: 'PMO-1', erp_number: 'SI-1', customer_name: 'Acme', amount: 11100, currency: 'IDR', invoice_date: '2026-03-10' },
        { pmo_invoice_id: 'n5', erp_invoice_id: 'e5', ambiguous: true, pmo_number: 'PMO-5', erp_number: 'SI-5', customer_name: 'Acme', amount: 7000, currency: 'IDR', invoice_date: '2026-03-13' },
      ],
      error: null,
    });

    const rows = await proposeInvoicePairs();

    expect(h.rpc).toHaveBeenCalledWith('propose_invoice_pairs');
    expect(rows).toEqual([
      { pmoInvoiceId: 'n1', erpInvoiceId: 'e1', ambiguous: false, pmoNumber: 'PMO-1', erpNumber: 'SI-1', customerName: 'Acme', amount: 11100, currency: 'IDR', invoiceDate: '2026-03-10' },
      { pmoInvoiceId: 'n5', erpInvoiceId: 'e5', ambiguous: true, pmoNumber: 'PMO-5', erpNumber: 'SI-5', customerName: 'Acme', amount: 7000, currency: 'IDR', invoiceDate: '2026-03-13' },
    ]);
  });

  it('AC-ECA-030 acceptInvoicePairs sends only the id pairs and returns the number applied', async () => {
    h.rpc.mockResolvedValue({ data: 2, error: null });

    const applied = await acceptInvoicePairs([{ pmoInvoiceId: 'n1', erpInvoiceId: 'e1' }, { pmoInvoiceId: 'n2', erpInvoiceId: 'e2' }]);

    expect(h.rpc).toHaveBeenCalledWith('accept_invoice_pairs', { p_pairs: [{ pmo: 'n1', erp: 'e1' }, { pmo: 'n2', erp: 'e2' }] });
    expect(applied).toBe(2);
  });

  it('acceptInvoicePairs surfaces a refusal as an error, never as zero applied', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'these invoices are not an unambiguous match', code: '23514', details: 'pair-not-eligible' } });
    await expect(acceptInvoicePairs([{ pmoInvoiceId: 'n1', erpInvoiceId: 'e1' }])).rejects.toThrow();
  });

  it('acceptInvoicePairs with nothing to accept makes no call', async () => {
    expect(await acceptInvoicePairs([])).toBe(0);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('listUnpairedNativeInvoices maps the reason a PMO invoice keeps counting', async () => {
    h.rpc.mockResolvedValue({
      data: [{ invoice_id: 'n3', pmo_number: 'PMO-3', customer_name: 'Acme', invoice_date: '2026-03-12', amount: 3000, currency: 'IDR', reason: 'has-receipt' }],
      error: null,
    });

    const rows = await listUnpairedNativeInvoices();

    expect(rows).toEqual([{ invoiceId: 'n3', pmoNumber: 'PMO-3', customerName: 'Acme', invoiceDate: '2026-03-12', amount: 3000, currency: 'IDR', reason: 'has-receipt' }]);
  });

  it('listAcceptedInvoicePairs reads PMO copies that now count as an ERP invoice, with the ERP number', async () => {
    h.pages = [[{ id: 'n1', pmo_number: 'PMO-1', amount: 11100, currency: 'IDR', paired_at: '2026-11-02T01:00:00Z', erp: { si_number: 'SI-1' } }]];

    const rows = await listAcceptedInvoicePairs();

    expect(h.notCalls).toContainEqual(['paired_erp_invoice_id', 'is', null]);
    expect(rows).toEqual([{ pmoInvoiceId: 'n1', pmoNumber: 'PMO-1', amount: 11100, currency: 'IDR', pairedAt: '2026-11-02T01:00:00Z', erpNumber: 'SI-1' }]);
  });
});
