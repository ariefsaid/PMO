import { describe, it, expect, vi } from 'vitest';
import { resolvePaymentRefs } from './dispatchProcurement.ts';

const docId = '00000000-0000-4000-8000-000000000001';
const baseDoc = { id: docId, org_id: 'org', erp_doctype: 'Purchase Invoice', erp_name: 'BILL-1', supplier: 'SUP-1', currency: 'USD', erp_docstatus: 1, is_return: false, outstanding_amount: 75 };
const baseLink = { org_id: 'org', procurement_id: 'purchase', erp_purchase_document_id: docId, erp_purchase_documents: baseDoc };
const purchase = { org_id: 'org', vendor_id: 'vendor', currency: 'USD', record_only: true };

type Options = { record?: Record<string, unknown>; purchase?: unknown; links?: unknown; org?: unknown; supplier?: unknown; errors?: Record<string, unknown>; replay?: boolean };
function setup(opts: Options = {}) {
  const record: Record<string, unknown> = { id: 'payment', erp_doc_kind: 'payment', procurementId: 'purchase', capturedInvoiceDocumentId: docId, paid_amount: 25, ...opts.record };
  const tables: Record<string, unknown> = { procurements: purchase, procurement_erp_links: [baseLink], organizations: { default_currency: 'USD' }, external_refs: { external_record_id: 'Supplier:SUP-1' } };
  if ('purchase' in opts) tables.procurements = opts.purchase;
  if ('links' in opts) tables.procurement_erp_links = opts.links;
  if ('org' in opts) tables.organizations = opts.org;
  if ('supplier' in opts) tables.external_refs = opts.supplier;
  const reads: Array<{ table: string; filters: Array<[string, string]> }> = [];
  const serviceClient = { from(table: string) { const filters: Array<[string, string]> = []; reads.push({ table, filters }); const result = () => ({ data: tables[table], error: opts.errors?.[table] ?? null }); const builder = { eq(col: string, value: string) { filters.push([col, value]); return builder; }, maybeSingle: async () => result(), then(resolve: (v: unknown) => unknown) { return Promise.resolve(result()).then(resolve); } }; return { select: () => builder }; } };
  const deps = { orgId: 'org', replay: opts.replay, command: { domain: 'procurement', operation: 'create', record }, serviceClient };
  return { record, reads, run: () => resolvePaymentRefs(deps as never) };
}
const withDoc = (patch: Record<string, unknown>) => [{ ...baseLink, erp_purchase_documents: { ...baseDoc, ...patch } }];

describe('captured invoice payment resolution', () => {
  it('resolves the linked invoice and supplier server-side, replacing caller references', async () => {
    const s = setup({ record: { references: [{ reference_name: 'untrusted' }], supplier: 'untrusted', pi_names: ['untrusted'], pmo_captured_supplier: 'untrusted' } });
    expect(await s.run()).toEqual({ refs: { pi: 'BILL-1', supplier: 'SUP-1' } });
    expect(s.record).toMatchObject({ supplier: 'vendor', pmo_captured_supplier: 'SUP-1', references: [{ reference_doctype: 'Purchase Invoice', reference_name: 'BILL-1', allocated_amount: 25 }] });
    expect(s.record).not.toHaveProperty('pi_names');
    expect(s.reads.find((r) => r.table === 'procurement_erp_links')?.filters).toContainEqual(['org_id', 'org']);
    expect(s.reads.find((r) => r.table === 'procurement_erp_links')?.filters).toContainEqual(['procurement_id', 'purchase']);
  });
  it.each([
    ['invalid selector', { record: { capturedInvoiceDocumentId: 'bad' } }, 'CAPTURE_INVOICE_SELECTOR_INVALID'],
    ['both invoice selectors', { record: { invoiceId: 'other' } }, 'CAPTURE_INVOICE_SELECTOR_INVALID'],
    ['missing purchase', { record: { procurementId: '' } }, 'CAPTURE_INVOICE_SELECTOR_INVALID'],
    ['precision', { record: { paid_amount: '1.001' } }, 'CAPTURE_PAYMENT_AMOUNT_INVALID'],
    ['zero amount', { record: { paid_amount: 0 } }, 'CAPTURE_PAYMENT_AMOUNT_INVALID'],
    ['negative amount', { record: { paid_amount: -1 } }, 'CAPTURE_PAYMENT_AMOUNT_INVALID'],
    ['purchase unreadable', { errors: { procurements: { code: '42501' } } }, 'CAPTURE_PURCHASE_QUERY_42501'],
    ['purchase absent', { purchase: null }, 'CAPTURE_PURCHASE_UNAVAILABLE'],
    ['purchase wrong org', { purchase: { ...purchase, org_id: 'other' } }, 'CAPTURE_PURCHASE_UNAVAILABLE'],
    ['not captured', { purchase: { ...purchase, record_only: false } }, 'CAPTURE_PURCHASE_UNAVAILABLE'],
    ['links unreadable', { errors: { procurement_erp_links: { code: 'secret' } } }, 'CAPTURE_INVOICE_LINK_QUERY_UNKNOWN'],
    ['no link', { links: [] }, 'CAPTURE_INVOICE_LINK_COUNT_INVALID'],
    ['multiple links', { links: [baseLink, baseLink] }, 'CAPTURE_INVOICE_LINK_COUNT_INVALID'],
    ['wrong purchase', { links: [{ ...baseLink, procurement_id: 'other' }] }, 'CAPTURE_INVOICE_LINK_MISMATCH'],
    ['wrong link org', { links: [{ ...baseLink, org_id: 'other' }] }, 'CAPTURE_INVOICE_LINK_MISMATCH'],
    ['wrong invoice', { links: [{ ...baseLink, erp_purchase_document_id: 'other' }] }, 'CAPTURE_INVOICE_LINK_MISMATCH'],
    ['wrong invoice org', { links: withDoc({ org_id: 'other' }) }, 'CAPTURE_INVOICE_DOCUMENT_MISMATCH'],
    ['wrong document type', { links: withDoc({ erp_doctype: 'Purchase Order' }) }, 'CAPTURE_INVOICE_DOCUMENT_MISMATCH'],
    ['draft invoice', { links: withDoc({ erp_docstatus: 0 }) }, 'CAPTURE_INVOICE_STATUS_INVALID'],
    ['return invoice', { links: withDoc({ is_return: true }) }, 'CAPTURE_INVOICE_STATUS_INVALID'],
    ['invoice currency', { links: withDoc({ currency: 'EUR' }) }, 'CAPTURE_INVOICE_CURRENCY_INVALID'],
    ['missing balance', { links: withDoc({ outstanding_amount: null }) }, 'CAPTURE_INVOICE_BALANCE_INVALID'],
    ['negative balance', { links: withDoc({ outstanding_amount: -1 }) }, 'CAPTURE_INVOICE_BALANCE_INVALID'],
    ['above residual', { record: { paid_amount: 76 } }, 'CAPTURE_PAYMENT_EXCEEDS_RESIDUAL'],
    ['organization unreadable', { errors: { organizations: { code: '42501' } } }, 'CAPTURE_ORG_CURRENCY_QUERY_42501'],
    ['organization currency', { org: { default_currency: 'EUR' } }, 'CAPTURE_ORG_CURRENCY_INVALID'],
    ['supplier mismatch', { supplier: { external_record_id: 'Supplier:OTHER' } }, 'CAPTURE_SUPPLIER_MISMATCH'],
  ] as Array<[string, Options, string]>)('refuses %s with a safe reason and a diagnostic code', async (_label, opts, code) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(setup(opts).run()).rejects.toMatchObject({ code: 'commit-rejected', message: 'capture_invoice_unavailable' });
      expect(log.mock.calls.flat().join(' ')).toContain(code);
    } finally { log.mockRestore(); }
  });
  it('logs supplier lookup failures as a safe diagnostic and refuses the payment', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(setup({ errors: { external_refs: { code: '42501', message: 'internal detail' } } }).run()).rejects.toMatchObject({ code: '42501' });
      expect(log.mock.calls.flat().join(' ')).toContain('CAPTURE_SUPPLIER_QUERY_42501');
      expect(log.mock.calls.flat().join(' ')).not.toContain('internal detail');
    } finally { log.mockRestore(); }
  });
  it('reports a fully settled invoice as complete', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try { await expect(setup({ links: withDoc({ outstanding_amount: 0 }) }).run()).rejects.toMatchObject({ message: 'history_complete' }); }
    finally { log.mockRestore(); }
  });
  it('retains a valid frozen allocation on replay and refuses a forged replay', async () => {
    const saved = { supplier: 'vendor', references: [{ reference_doctype: 'Purchase Invoice', reference_name: 'BILL-1', allocated_amount: 25 }] };
    const s = setup({ replay: true, record: saved });
    expect(await s.run()).toEqual({ refs: { pi: 'BILL-1' } });
    expect(s.reads).toHaveLength(0);
    await expect(setup({ replay: true, record: { ...saved, references: [] } }).run()).rejects.toMatchObject({ message: 'capture_invoice_unavailable' });
  });
});

it('sends a single payment against the resolved existing invoice and does not retry a lost submit', async () => {
  const { createErpAdapter } = await import('./adapter.ts');
  const { DOCTYPE_BODIES } = await import('./doctypeBodies.ts');
  const s = setup({ record: { date: '2026-01-01' } });
  const { refs } = await s.run();
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
    if (init?.method === 'POST') return Response.json({ name: 'PAY-1' });
    return Response.json({ message: 'unavailable' }, { status: 500 });
  });
  const adapter = createErpAdapter({ client: { fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: 'key', apiSecret: 'secret', baseUrl: 'https://example.test', maxRetries: 3 }, doctypeBodies: DOCTYPE_BODIES, ctx: { refs, config: { default_cash_account: 'Cash', default_payable_account: 'Payable' } } });
  await expect(adapter.commit({ domain: 'procurement', operation: 'create', idempotencyKey: 'intent', record: s.record as { id: string } })).rejects.toBeDefined();
  expect(calls.map((call) => call.method)).toEqual(['POST', 'PUT']);
  expect(calls.every((call) => call.url.includes('Payment%20Entry'))).toBe(true);
  expect(calls[0].body).toMatchObject({ party: 'SUP-1', paid_amount: 25, references: [{ reference_doctype: 'Purchase Invoice', reference_name: 'BILL-1', allocated_amount: 25 }] });
});
