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
  single: null as Record<string, unknown> | null,
  inCalls: [] as Array<[string, unknown]>,
  rpcPageQueries: [] as Array<{ name: string; from: number; to: number; order: string[] }>,
}));
vi.mock('@/src/lib/supabase/client', () => ({
  supabase: {
    rpc: (name: string, args?: unknown) => {
      let from = 0;
      let to = 999;
      const order: string[] = [];
      const query: Record<string, unknown> = {};
      Object.assign(query, {
        order: (column: string, options: { ascending?: boolean } = {}) => {
          order.push(`${column}:${options.ascending === false ? 'desc' : 'asc'}`);
          return query;
        },
        range: (start: number, end: number) => {
          from = start;
          to = end;
          h.rpcPageQueries.push({ name, from, to, order: [...order] });
          return query;
        },
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(args === undefined ? h.rpc(name) : h.rpc(name, args)).then(
            (response: { data: unknown; error: unknown }) => resolve({
              ...response,
              data: Array.isArray(response.data) ? response.data.slice(from, to + 1) : response.data,
            }),
            reject,
          ),
      });
      return query;
    },
    from: () => {
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b,
        eq: () => b,
        in: (c: string, v: unknown) => { h.inCalls.push([c, v]); return b; },
        maybeSingle: () => Promise.resolve({ data: h.single, error: null }),
        not: (c: string, op: string, v: unknown) => { h.notCalls.push([c, op, v]); return b; },
        order: () => b,
        range: () => b,
        then: (resolve: (v: { data: unknown; error: null }) => unknown) => resolve({ data: h.pages.shift() ?? [], error: null }),
      });
      return b;
    },
  },
}));

import { proposeInvoicePairs, acceptInvoicePairs, unpairInvoice, getSalesInvoice, listUnpairedNativeInvoices, listAcceptedInvoicePairs } from './revenue';

beforeEach(() => { h.rpc.mockReset(); h.pages = []; h.notCalls = []; h.single = null; h.inCalls = []; h.rpcPageQueries = []; });

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

  it('FR-ECA-040 proposeInvoicePairs reads every proposal beyond the 1,000-row PostgREST cap in stable pages', async () => {
    const data = Array.from({ length: 1001 }, (_, i) => ({
      pmo_invoice_id: `n${i}`, erp_invoice_id: `e${i}`, ambiguous: false, pmo_number: `PMO-${i}`, erp_number: `SI-${i}`,
      customer_name: 'Acme', amount: 100, currency: 'IDR', invoice_date: '2026-03-10',
    }));
    h.rpc.mockResolvedValue({ data, error: null });

    const rows = await proposeInvoicePairs();

    expect(rows).toHaveLength(1001);
    expect(rows.at(-1)?.pmoInvoiceId).toBe('n1000');
    expect(h.rpcPageQueries).toEqual([
      { name: 'propose_invoice_pairs', from: 0, to: 999, order: ['invoice_date:asc', 'pmo_number:asc', 'erp_number:asc', 'pmo_invoice_id:asc', 'erp_invoice_id:asc'] },
      { name: 'propose_invoice_pairs', from: 1000, to: 1999, order: ['invoice_date:asc', 'pmo_number:asc', 'erp_number:asc', 'pmo_invoice_id:asc', 'erp_invoice_id:asc'] },
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

  it('I3 unpairInvoice sends the PMO invoice id and surfaces a refusal', async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    await unpairInvoice('n1');
    expect(h.rpc).toHaveBeenCalledWith('unpair_invoice', { p_pmo_id: 'n1' });

    h.rpc.mockResolvedValue({ data: null, error: { message: 'this invoice is not paired', code: '23514', details: 'not-paired' } });
    await expect(unpairInvoice('n1')).rejects.toMatchObject({ code: '23514', details: 'not-paired' });
  });

  it('M10 getSalesInvoice carries the ERP invoice number a paired copy counts as', async () => {
    h.single = { id: 'n1', paired_erp_invoice_id: 'e1', companies: null, sales_invoice_authors: [] };
    h.pages = [[{ id: 'e1', si_number: 'SI-9' }]];
    expect((await getSalesInvoice('n1'))?.paired_erp_number).toBe('SI-9');
    expect(h.inCalls).toContainEqual(['id', ['e1']]);

    h.inCalls = [];
    h.single = { id: 'x', paired_erp_invoice_id: null, companies: null, sales_invoice_authors: [] };
    expect((await getSalesInvoice('x'))?.paired_erp_number).toBeUndefined();
    expect(h.inCalls).toEqual([]);
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

  it('FR-ECA-040 listUnpairedNativeInvoices reads every invoice beyond the 1,000-row PostgREST cap in stable pages', async () => {
    const data = Array.from({ length: 1001 }, (_, i) => ({
      invoice_id: `n${i}`, pmo_number: `PMO-${i}`, customer_name: 'Acme', invoice_date: '2026-03-10', amount: 100,
      currency: 'IDR', reason: 'no-match',
    }));
    h.rpc.mockResolvedValue({ data, error: null });

    const rows = await listUnpairedNativeInvoices();

    expect(rows).toHaveLength(1001);
    expect(rows.at(-1)?.invoiceId).toBe('n1000');
    expect(h.rpcPageQueries).toEqual([
      { name: 'list_unpaired_native_invoices', from: 0, to: 999, order: ['invoice_date:asc', 'pmo_number:asc', 'invoice_id:asc'] },
      { name: 'list_unpaired_native_invoices', from: 1000, to: 1999, order: ['invoice_date:asc', 'pmo_number:asc', 'invoice_id:asc'] },
    ]);
  });

  it('listAcceptedInvoicePairs reads PMO copies that now count as an ERP invoice, with the ERP number', async () => {
    // two reads: the paired PMO copies, then the numbers of the ERP invoices they point at (a self-embed is not resolvable by PostgREST)
    h.pages = [
      [{ id: 'n1', pmo_number: 'PMO-1', amount: 11100, currency: 'IDR', paired_at: '2026-11-02T01:00:00Z', paired_erp_invoice_id: 'e1' }],
      [{ id: 'e1', si_number: 'SI-1' }],
    ];

    const rows = await listAcceptedInvoicePairs();

    expect(h.notCalls).toContainEqual(['paired_erp_invoice_id', 'is', null]);
    expect(h.inCalls).toContainEqual(['id', ['e1']]);
    expect(rows).toEqual([{ pmoInvoiceId: 'n1', pmoNumber: 'PMO-1', amount: 11100, currency: 'IDR', pairedAt: '2026-11-02T01:00:00Z', erpNumber: 'SI-1' }]);
  });
});
