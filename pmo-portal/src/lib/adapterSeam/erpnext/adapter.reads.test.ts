/**
 * erpnext/adapter reads (ADR-0055 FR-EAS-021): the same two read operations every adapter promises,
 * with the external identity and per-domain change feed defined at the seam.
 */
import { describe, expect, it, vi } from 'vitest';
import { createErpAdapter, type ErpAdapterDeps } from './adapter.ts';
import { erpExternalIdTargets } from './adapterReads.ts';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const fromDocByName = (doc: unknown) => ({ id: String((doc as { name: string }).name) });
const bodies = (...kinds: string[]) =>
  Object.fromEntries(kinds.map((kind) => [kind, { toBody: () => ({}), fromDoc: fromDocByName }])) as ErpAdapterDeps['doctypeBodies'];

function depsFor(
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
  overrides: Partial<ErpAdapterDeps> = {},
): ErpAdapterDeps {
  return {
    client: { fetchImpl: vi.fn(fetchImpl) as unknown as typeof fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.com' },
    doctypeBodies: {},
    ctx: { refs: {}, config: {} },
    ...overrides,
  };
}

describe('erpExternalIdTargets: the external identity of a record, per domain', () => {
  it('party ids carry their doctype prefix', () => {
    expect(erpExternalIdTargets('companies', 'Supplier:ACME')).toEqual([{ kind: 'supplier', name: 'ACME' }]);
    expect(erpExternalIdTargets('companies', 'Customer:ACME')).toEqual([{ kind: 'customer', name: 'ACME' }]);
  });

  it('a raw document name is tried against every raw-named kind of the domain', () => {
    const kinds = erpExternalIdTargets('procurement', 'DOC-0001').map((t) => t.kind);
    expect(kinds).toEqual(expect.arrayContaining(['purchase-order', 'purchase-invoice', 'goods-receipt']));
    expect(erpExternalIdTargets('procurement', 'DOC-0001').every((t) => t.name === 'DOC-0001')).toBe(true);
    expect(kinds).not.toContain('supplier');
  });

  it('the "<Doctype>:<name>" form is honoured only inside the requested domain', () => {
    expect(erpExternalIdTargets('procurement', 'Purchase Order:PO-1')).toEqual([{ kind: 'purchase-order', name: 'PO-1' }]);
    expect(() => erpExternalIdTargets('procurement', 'Supplier:ACME')).toThrow(/commit-rejected|not a procurement/i);
  });

  it('a domain the adapter does not own is refused', () => {
    expect(() => erpExternalIdTargets('tasks', 'X-1')).toThrow();
  });
});

describe('erpnext adapter getByExternalId', () => {
  it('resolves a raw procurement document name by probing the domain doctypes until one has it', async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(decodeURIComponent(url));
      return url.includes('Purchase%20Order') ? jsonResponse(200, { name: 'PO-0007' }) : jsonResponse(404, { exc_type: 'DoesNotExistError' });
    };
    const adapter = createErpAdapter(depsFor(fetchImpl, { doctypeBodies: bodies('purchase-request', 'rfq', 'quotation', 'purchase-order', 'goods-receipt', 'purchase-invoice', 'payment') }));
    await expect(adapter.getByExternalId('procurement', 'PO-0007')).resolves.toEqual({ id: 'PO-0007' });
    expect(urls.some((u) => u.includes('/Purchase Order/PO-0007'))).toBe(true);
  });

  it('returns null when no doctype of the domain has the name', async () => {
    const adapter = createErpAdapter(depsFor(async () => jsonResponse(404, {}), { doctypeBodies: bodies('purchase-request', 'rfq', 'quotation', 'purchase-order', 'goods-receipt', 'purchase-invoice', 'payment') }));
    await expect(adapter.getByExternalId('procurement', 'NOPE-1')).resolves.toBeNull();
  });
});

describe('erpnext adapter listChangesSinceWatermark', () => {
  const siRow = (name: string, modified: string) => ({ name, modified, docstatus: 1, company: 'Co' });
  const feed = (rows: Record<string, unknown[]>) => async (url: string) => {
    const decoded = decodeURIComponent(url);
    const doctype = Object.keys(rows).find((d) => decoded.includes(`/api/resource/${d}?`));
    return jsonResponse(200, { data: doctype ? rows[doctype] : [] });
  };
  const revenueDeps = (fetchImpl: (url: string) => Promise<Response>) =>
    depsFor(fetchImpl, { doctypeBodies: bodies('sales-invoice', 'incoming-payment'), readScope: { company: 'Co' } });

  it('lists the domain changes for every kind and returns a resumable per-kind cursor', async () => {
    const adapter = createErpAdapter(revenueDeps(feed({ 'Sales Invoice': [siRow('SI-1', '2026-01-01 10:00:00'), siRow('SI-2', '2026-01-02 10:00:00')] })));
    const page = await adapter.listChangesSinceWatermark('revenue', null);
    expect(page.changes.map((c) => c.id)).toEqual(['SI-1', 'SI-2']);
    expect(JSON.parse(page.nextCursor!)).toEqual({ 'sales-invoice': '2026-01-02 10:00:00' });
  });

  it('resumes each kind from its own cursor and reports caught-up (null) when only the boundary row returns', async () => {
    const urls: string[] = [];
    const inner = feed({ 'Sales Invoice': [siRow('SI-2', '2026-01-02 10:00:00')] });
    const adapter = createErpAdapter(revenueDeps(async (url) => { urls.push(decodeURIComponent(url)); return inner(url); }));
    const page = await adapter.listChangesSinceWatermark('revenue', JSON.stringify({ 'sales-invoice': '2026-01-02 10:00:00' }));
    expect(urls.some((u) => u.includes('["modified",">=","2026-01-02 10:00:00"]'))).toBe(true);
    expect(page.nextCursor).toBeNull();
  });

  it('scopes company-owned doctypes to the binding company', async () => {
    const urls: string[] = [];
    const adapter = createErpAdapter(revenueDeps(async (url) => { urls.push(decodeURIComponent(url)); return jsonResponse(200, { data: [] }); }));
    await adapter.listChangesSinceWatermark('revenue', null);
    expect(urls.some((u) => u.includes('/Sales Invoice?') && u.includes('"company"') && u.includes('"Co"'))).toBe(true);
  });

  it('refuses a company-owned domain read with no company, rather than returning a partial feed', async () => {
    const adapter = createErpAdapter(depsFor(async () => jsonResponse(200, { data: [] }), { doctypeBodies: bodies('sales-invoice', 'incoming-payment') }));
    await expect(adapter.listChangesSinceWatermark('revenue', null)).rejects.toMatchObject({ code: 'commit-rejected' });
  });

  it('refuses a kind whose body mapper is not wired', async () => {
    const adapter = createErpAdapter(depsFor(async () => jsonResponse(200, { data: [] }), { readScope: { company: 'Co' } }));
    await expect(adapter.listChangesSinceWatermark('revenue', null)).rejects.toMatchObject({ code: 'commit-rejected' });
  });
});
