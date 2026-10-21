import { describe, expect, it, vi } from 'vitest';
import { feedPurchaseMirror, purchaseWmDomain } from './purchaseMirrorFeed.ts';
import { FakePostgrest } from '@/test/postgrestFake.ts';

const PO = { name: 'PUR-ORD-1', supplier: 'SUP-1', supplier_name: 'Acme', transaction_date: '2026-01-05', schedule_date: '2026-01-20',
  currency: 'IDR', grand_total: 900000, status: 'To Bill', docstatus: 1, project: 'ERP-A', modified: '2026-01-05 09:00:00' };
const PI = { name: 'ACC-PINV-1', supplier: 'SUP-1', supplier_name: 'Acme', posting_date: '2026-02-01', due_date: '2026-03-01',
  bill_no: 'INV-77', currency: 'IDR', grand_total: 500000, outstanding_amount: 500000, status: 'Unpaid', docstatus: 1,
  is_return: 0, project: null, modified: '2026-02-01 10:00:00' };

function harness(docs: Record<string, unknown[]>) {
  const fake = new FakePostgrest({ external_sync_watermarks: [] }, { upsertKeys: { external_sync_watermarks: ['org_id', 'external_tier', 'domain'] } });
  const rpc = vi.fn().mockImplementation(async (_n: string, a: { p_rows: unknown[] }) => ({ data: a.p_rows.length, error: null }));
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (url: string) => {
    urls.push(decodeURIComponent(url));
    const doctype = decodeURIComponent(new URL(url).pathname.split('/').pop()!);
    return new Response(JSON.stringify({ data: docs[doctype] ?? [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  const sc = { from: (t: string) => fake.from(t), rpc } as never;
  const client = { fetchImpl, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.test', maxRetries: 0 };
  return { fake, rpc, urls, sc, client };
}

describe('erpnext/purchaseMirrorFeed', () => {
  it('AC-EPR-001 mirrors ERP-native POs and PIs with ERP figures and advances each watermark', async () => {
    const h = harness({ 'Purchase Order': [PO], 'Purchase Invoice': [PI] });
    const result = await feedPurchaseMirror(h.sc, { client: h.client, orgId: 'org-1', company: 'Example Co' });

    expect(result).toEqual({ fed: 2, caughtUp: true });
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith('upsert_erp_purchase_documents', { p_org_id: 'org-1', p_rows: [expect.objectContaining({
      erp_doctype: 'Purchase Order', erp_name: 'PUR-ORD-1', supplier_name: 'Acme', doc_date: '2026-01-05', due_date: '2026-01-20',
      grand_total: '900000', outstanding_amount: null, bill_no: null, erp_status: 'To Bill', erp_project: 'ERP-A', erp_docstatus: 1 }),
    expect.objectContaining({
      erp_doctype: 'Purchase Invoice', erp_name: 'ACC-PINV-1', doc_date: '2026-02-01', due_date: '2026-03-01', bill_no: 'INV-77',
      grand_total: '500000', outstanding_amount: '500000', erp_status: 'Unpaid', erp_project: null, is_return: false })] });
    const wm = Object.fromEntries(h.fake.rowsOf('external_sync_watermarks').map((r) => [r.domain, r.watermark_cursor]));
    expect(wm).toEqual({ [purchaseWmDomain('Purchase Order')]: PO.modified, [purchaseWmDomain('Purchase Invoice')]: PI.modified });
    // Company-scoped, drafts never listed.
    expect(h.urls.every((u) => u.includes('["company","=","Example Co"]') && u.includes('["docstatus","in",[1,2]]'))).toBe(true);
  });

  it('AC-EPR-001 resumes from the stored watermark and still calls the RPC with no rows (re-stamps attribution)', async () => {
    const h = harness({});
    h.fake.rowsOf('external_sync_watermarks').push({ org_id: 'org-1', external_tier: 'erpnext', domain: purchaseWmDomain('Purchase Invoice'), watermark_cursor: '2026-02-01 10:00:00' });
    await feedPurchaseMirror(h.sc, { client: h.client, orgId: 'org-1', company: 'Example Co' });
    expect(h.urls.find((u) => u.includes('Purchase Invoice'))).toContain('["modified",">=","2026-02-01 10:00:00"]');
    expect(h.rpc).toHaveBeenCalledWith('upsert_erp_purchase_documents', { p_org_id: 'org-1', p_rows: [] });
    expect(h.fake.rowsOf('external_sync_watermarks')[0].watermark_cursor).toBe('2026-02-01 10:00:00');
  });

  it('fails closed on a malformed ERP response without moving the watermark', async () => {
    const h = harness({ 'Purchase Order': [{ name: 'X' }] });
    await expect(feedPurchaseMirror(h.sc, { client: h.client, orgId: 'org-1', company: 'Example Co' })).rejects.toThrow(/malformed/);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.fake.rowsOf('external_sync_watermarks')).toHaveLength(0);
  });

  it('fails closed when the RPC errors, leaving the watermark behind', async () => {
    const h = harness({ 'Purchase Order': [PO] });
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(feedPurchaseMirror(h.sc, { client: h.client, orgId: 'org-1', company: 'Example Co' })).rejects.toThrow('boom');
    expect(h.fake.rowsOf('external_sync_watermarks')).toHaveLength(0);
  });

  it('keeps the newest copy of a document delivered twice, nulls unparseable fields, and takes the max modified as the cursor', async () => {
    const h = harness({ 'Purchase Invoice': [
      { ...PI, modified: '2026-02-03 00:00:00', status: 'Paid', outstanding_amount: 0 },
      { ...PI, modified: '2026-02-01 10:00:00' },
      { ...PI, name: 'ACC-PINV-2', grand_total: 'n/a', due_date: '03/01/2026', modified: '2026-02-02 00:00:00' },
    ] });
    await feedPurchaseMirror(h.sc, { client: h.client, orgId: 'org-1', company: 'Example Co' });
    const rows = h.rpc.mock.calls[0][1].p_rows as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.erp_name === 'ACC-PINV-1')).toMatchObject({ erp_status: 'Paid', outstanding_amount: '0' });
    expect(rows.find((r) => r.erp_name === 'ACC-PINV-2')).toMatchObject({ grand_total: null, due_date: null });
    const wm = h.fake.rowsOf('external_sync_watermarks').find((r) => r.domain === purchaseWmDomain('Purchase Invoice'));
    expect(wm?.watermark_cursor).toBe('2026-02-03 00:00:00');
  });

  it('refuses to run without a company', async () => {
    const h = harness({});
    await expect(feedPurchaseMirror(h.sc, { client: h.client, orgId: 'org-1', company: ' ' })).rejects.toThrow(/company/);
  });
});
