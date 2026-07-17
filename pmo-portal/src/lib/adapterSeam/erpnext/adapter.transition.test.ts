/**
 * erpnext/adapter.ts — commit() operation:'transition' (task 4.4 + Slice-6 completion task 6.3).
 * `create` already does the R9 two-step (insert->submit->re-fetch, task 2.12) for every submittable
 * kind, so a fresh 'transition' command is for an ALREADY-CREATED doc. The three verbs (Slice 6
 * completes the surface, FR-ENA-050/117, OQ-7):
 *  - `verb:'submit'` (task 4.4): PUTs `{docstatus:1}`, fires `afterSubmitHook`, re-fetches.
 *  - `verb:'cancel'` (task 6.3): PUTs `{docstatus:2}` (OQ-8 cancel-only — stock REST enforces it),
 *    re-fetches, returns the tombstoned canonical.
 *  - `verb:'amend'` (task 6.3): cancels the old doc, creates a new doc carrying `amended_from` = old
 *    name (the lineage FR-ENA-053 seam), stamps the idempotency key into the anchor field, submits,
 *    re-fetches — returns the NEW ERP `name` + the amended canonical.
 *
 * Separate file from `adapter.test.ts` (task 2.12's shipped suite) so this additive behavior never
 * edits that file beyond the one stale "update not yet wired" placeholder task 6.3 retires.
 */
import { describe, expect, it, vi } from 'vitest';
import { AdapterError } from '../contract.ts';
import { createErpAdapter, type ErpAdapterDeps } from './adapter.ts';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function baseDeps(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>, overrides: Partial<ErpAdapterDeps> = {}): ErpAdapterDeps {
  return {
    client: { fetchImpl: vi.fn(fetchImpl) as unknown as typeof fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.com' },
    doctypeBodies: {
      'purchase-request': { toBody: () => ({}), fromDoc: (doc) => ({ id: 'placeholder', pr_number: (doc as { name: string }).name, erp_docstatus: (doc as { docstatus: number }).docstatus }) },
    },
    ctx: { refs: {}, config: { company: 'PMO Smoke Co' } },
    ...overrides,
  };
}

describe('erpnext/adapter — commit() transition, verb:submit (task 4.4)', () => {
  it('FR-ENA-044/117 PUTs {docstatus:1} on the resolved externalRecordId, then re-fetches (never trusts the PUT body)', async () => {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (init?.method === 'PUT') return jsonResponse(200, { name: 'MAT-REQ-2026-00001', docstatus: 1, status: 'Draft' });
      return jsonResponse(200, { name: 'MAT-REQ-2026-00001', docstatus: 1 });
    };
    const adapter = createErpAdapter(baseDeps(fetchImpl));
    const result = await adapter.commit({
      domain: 'procurement',
      operation: 'transition',
      record: { id: 'pmo-mr-1', erp_doc_kind: 'purchase-request', externalRecordId: 'MAT-REQ-2026-00001', verb: 'submit' },
    });
    expect(calls.map((c) => c.method)).toEqual(['PUT', 'GET']);
    expect(calls[0].body).toEqual({ docstatus: 1 });
    expect(result.externalRecordId).toBe('MAT-REQ-2026-00001');
    expect(result.canonical).toMatchObject({ id: 'pmo-mr-1', pr_number: 'MAT-REQ-2026-00001', erp_docstatus: 1 });
  });

  it('fires afterSubmitHook right after the submit PUT, before the re-fetch (FR-ENA-003 parity with create)', async () => {
    const order: string[] = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        order.push('submit');
        return jsonResponse(200, { name: 'MAT-REQ-2026-00001', docstatus: 1 });
      }
      order.push('refetch');
      return jsonResponse(200, { name: 'MAT-REQ-2026-00001', docstatus: 1 });
    };
    const afterSubmitHook = vi.fn(async () => {
      order.push('hook');
    });
    const adapter = createErpAdapter(baseDeps(fetchImpl, { afterSubmitHook }));
    await adapter.commit({
      domain: 'procurement',
      operation: 'transition',
      record: { id: 'pmo-mr-1', erp_doc_kind: 'purchase-request', externalRecordId: 'MAT-REQ-2026-00001', verb: 'submit' },
    });
    expect(order).toEqual(['submit', 'hook', 'refetch']);
  });

  it('rejects a transition with no externalRecordId (nothing to submit) as commit-rejected', async () => {
    const adapter = createErpAdapter(baseDeps(async () => jsonResponse(200, {})));
    await expect(
      adapter.commit({ domain: 'procurement', operation: 'transition', record: { id: 'pmo-mr-1', erp_doc_kind: 'purchase-request', verb: 'submit' } }),
    ).rejects.toMatchObject({ code: 'commit-rejected' });
  });

  it('rejects a transition for a kind with no DOCTYPE_BODIES entry (loud, never a silent no-op)', async () => {
    const adapter = createErpAdapter(baseDeps(async () => jsonResponse(200, {}), { doctypeBodies: {} }));
    await expect(
      adapter.commit({ domain: 'procurement', operation: 'transition', record: { id: 'pmo-mr-1', erp_doc_kind: 'purchase-request', externalRecordId: 'MAT-REQ-2026-00001', verb: 'submit' } }),
    ).rejects.toMatchObject({ code: 'commit-rejected' });
  });
});

describe('erpnext/adapter — commit() transition, verb:cancel (task 6.3, FR-ENA-050/117, OQ-8)', () => {
  it('PUTs {docstatus:2} on the resolved externalRecordId, then re-fetches the tombstoned canonical', async () => {
    const calls: Array<{ method: string; body?: unknown }> = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (init?.method === 'PUT') return jsonResponse(200, { name: 'ACC-PINV-2026-00001', docstatus: 2 });
      return jsonResponse(200, { name: 'ACC-PINV-2026-00001', docstatus: 2, outstanding_amount: 0, grand_total: 150000 });
    };
    const adapter = createErpAdapter(
      baseDeps(fetchImpl, {
        doctypeBodies: { 'purchase-invoice': { toBody: () => ({}), fromDoc: (doc) => ({ id: 'placeholder', vi_number: (doc as { name: string }).name, erp_docstatus: (doc as { docstatus: number }).docstatus }) } },
      }),
    );
    const result = await adapter.commit({
      domain: 'procurement',
      operation: 'transition',
      record: { id: 'pmo-pi-1', erp_doc_kind: 'purchase-invoice', externalRecordId: 'ACC-PINV-2026-00001', verb: 'cancel' },
    });
    expect(calls.map((c) => c.method)).toEqual(['PUT', 'GET']);
    expect(calls[0].body).toEqual({ docstatus: 2 });
    expect(result.externalRecordId).toBe('ACC-PINV-2026-00001');
    expect(result.canonical).toMatchObject({ id: 'pmo-pi-1', erp_docstatus: 2 });
  });

  it('cancel works for Payment Entry too (verb:cancel on a PE, same PUT {docstatus:2} shape)', async () => {
    const calls: Array<{ method: string; body?: unknown }> = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (init?.method === 'PUT') return jsonResponse(200, { name: 'ACC-PAY-2026-00001', docstatus: 2 });
      return jsonResponse(200, { name: 'ACC-PAY-2026-00001', docstatus: 2, paid_amount: 150000 });
    };
    const adapter = createErpAdapter(
      baseDeps(fetchImpl, {
        doctypeBodies: { payment: { toBody: () => ({}), fromDoc: (doc) => ({ id: 'placeholder', pay_number: (doc as { name: string }).name, erp_docstatus: (doc as { docstatus: number }).docstatus }) } },
      }),
    );
    const result = await adapter.commit({
      domain: 'procurement',
      operation: 'transition',
      record: { id: 'pmo-pe-1', erp_doc_kind: 'payment', externalRecordId: 'ACC-PAY-2026-00001', verb: 'cancel' },
    });
    expect(calls.map((c) => c.method)).toEqual(['PUT', 'GET']);
    expect(calls[0].body).toEqual({ docstatus: 2 });
    expect(result.externalRecordId).toBe('ACC-PAY-2026-00001');
    expect(result.canonical).toMatchObject({ id: 'pmo-pe-1', erp_docstatus: 2 });
  });

  it('rejects a cancel with no externalRecordId (nothing to cancel) as commit-rejected', async () => {
    const adapter = createErpAdapter(
      baseDeps(async () => jsonResponse(200, {}), {
        doctypeBodies: { 'purchase-invoice': { toBody: () => ({}), fromDoc: () => ({ id: 'placeholder' }) } },
      }),
    );
    await expect(
      adapter.commit({ domain: 'procurement', operation: 'transition', record: { id: 'pmo-pi-1', erp_doc_kind: 'purchase-invoice', verb: 'cancel' } }),
    ).rejects.toMatchObject({ code: 'commit-rejected' });
  });
});

describe('erpnext/adapter — commit() transition, verb:amend (task 6.3, FR-ENA-050/053)', () => {
  it('cancels the old doc, creates a new doc carrying amended_from + the anchor stamp, submits, re-fetches the NEW name', async () => {
    const calls: Array<{ method: string; body?: unknown }> = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined });
      // cancel the old (PUT docstatus:2)
      if (init?.method === 'PUT' && init.body && JSON.parse(init.body as string).docstatus === 2) {
        return jsonResponse(200, { name: 'ACC-PINV-2026-00001', docstatus: 2 });
      }
      // create the new amended doc (POST)
      if (init?.method === 'POST') return jsonResponse(200, { name: 'ACC-PINV-2026-00002' });
      // submit the new (PUT docstatus:1)
      if (init?.method === 'PUT') return jsonResponse(200, { name: 'ACC-PINV-2026-00002', docstatus: 1 });
      // re-fetch the new
      return jsonResponse(200, { name: 'ACC-PINV-2026-00002', docstatus: 1, amended_from: 'ACC-PINV-2026-00001', outstanding_amount: 0, grand_total: 160000 });
    };
    const adapter = createErpAdapter(
      baseDeps(fetchImpl, {
        doctypeBodies: {
          'purchase-invoice': {
            toBody: (rec) => ({ supplier: 'Spike Supplier', items: rec.items }),
            fromDoc: (doc) => ({ id: 'placeholder', vi_number: (doc as { name: string }).name, erp_amended_from: (doc as { amended_from?: string }).amended_from ?? null, erp_docstatus: (doc as { docstatus: number }).docstatus }),
          },
        },
      }),
    );
    const result = await adapter.commit({
      domain: 'procurement',
      operation: 'transition',
      record: { id: 'pmo-pi-1', erp_doc_kind: 'purchase-invoice', externalRecordId: 'ACC-PINV-2026-00001', verb: 'amend', items: [{ item_code: 'X', qty: 2 }] },
      idempotencyKey: 'idem-amend-1',
    });
    expect(calls.map((c) => c.method)).toEqual(['PUT', 'POST', 'PUT', 'GET']);
    // cancel old
    expect(calls[0].body).toEqual({ docstatus: 2 });
    // create new: amended_from = old name + the PI anchor stamp ('remarks') = the amend idempotency key
    expect(calls[1].body).toMatchObject({ amended_from: 'ACC-PINV-2026-00001', remarks: 'idem-amend-1', supplier: 'Spike Supplier', items: [{ item_code: 'X', qty: 2 }] });
    // submit new
    expect(calls[2].body).toEqual({ docstatus: 1 });
    // the NEW ERP name is returned (external_refs will repoint to it)
    expect(result.externalRecordId).toBe('ACC-PINV-2026-00002');
    expect(result.canonical).toMatchObject({ id: 'pmo-pi-1', vi_number: 'ACC-PINV-2026-00002', erp_amended_from: 'ACC-PINV-2026-00001', erp_docstatus: 1 });
  });

  it('amend fires afterSubmitHook after the new doc submits (FR-ENA-003 seam parity)', async () => {
    const order: string[] = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT' && init.body && JSON.parse(init.body as string).docstatus === 2) { order.push('cancel'); return jsonResponse(200, { name: 'ACC-PINV-2026-00001', docstatus: 2 }); }
      if (init?.method === 'POST') { order.push('create'); return jsonResponse(200, { name: 'ACC-PINV-2026-00002' }); }
      if (init?.method === 'PUT') { order.push('submit'); return jsonResponse(200, { name: 'ACC-PINV-2026-00002', docstatus: 1 }); }
      order.push('refetch');
      return jsonResponse(200, { name: 'ACC-PINV-2026-00002', docstatus: 1, amended_from: 'ACC-PINV-2026-00001' });
    };
    const afterSubmitHook = vi.fn(async () => { order.push('hook'); });
    const adapter = createErpAdapter(
      baseDeps(fetchImpl, {
        afterSubmitHook,
        doctypeBodies: { 'purchase-invoice': { toBody: (rec) => ({ items: rec.items }), fromDoc: (doc) => ({ id: 'placeholder', vi_number: (doc as { name: string }).name }) } },
      }),
    );
    await adapter.commit({
      domain: 'procurement',
      operation: 'transition',
      record: { id: 'pmo-pi-1', erp_doc_kind: 'purchase-invoice', externalRecordId: 'ACC-PINV-2026-00001', verb: 'amend', items: [{ item_code: 'X', qty: 1 }] },
    });
    expect(order).toEqual(['cancel', 'create', 'submit', 'hook', 'refetch']);
  });

  it('rejects an amend with no externalRecordId (no old name to amend from) as commit-rejected', async () => {
    const adapter = createErpAdapter(
      baseDeps(async () => jsonResponse(200, {}), {
        doctypeBodies: { 'purchase-invoice': { toBody: () => ({}), fromDoc: () => ({ id: 'placeholder' }) } },
      }),
    );
    await expect(
      adapter.commit({ domain: 'procurement', operation: 'transition', record: { id: 'pmo-pi-1', erp_doc_kind: 'purchase-invoice', verb: 'amend' } }),
    ).rejects.toMatchObject({ code: 'commit-rejected' });
  });
});

describe('erpnext/adapter — commit() update on a SUBMITTABLE kind (task 6.3 update-draft, FR-ENA-050)', () => {
  it('operation:update on a DRAFT (docstatus 0) does a direct field PUT — routeEdit(0)=update', async () => {
    const calls: Array<{ method: string; body?: unknown }> = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (init?.method === 'GET') return jsonResponse(200, { name: 'ACC-PINV-2026-00001', docstatus: 0 });
      return jsonResponse(200, { name: 'ACC-PINV-2026-00001', docstatus: 0, outstanding_amount: 150000, grand_total: 150000 });
    };
    const adapter = createErpAdapter(
      baseDeps(fetchImpl, {
        ctx: { refs: { supplier: 'Spike Supplier' }, config: { company: 'PMO Smoke Co' } },
        doctypeBodies: { 'purchase-invoice': { toBody: (rec) => ({ supplier: 'Spike Supplier', items: rec.items }), fromDoc: (doc) => ({ id: 'placeholder', vi_number: (doc as { name: string }).name, erp_docstatus: (doc as { docstatus: number }).docstatus }) } },
      }),
    );
    const result = await adapter.commit({
      domain: 'procurement',
      operation: 'update',
      record: { id: 'pmo-pi-1', erp_doc_kind: 'purchase-invoice', externalRecordId: 'ACC-PINV-2026-00001', items: [{ item_code: 'X', qty: 1, rate: 150000 }] },
    });
    // GET (read docstatus) -> routeEdit(0)=update -> direct field PUT (no docstatus in the patch)
    expect(calls.map((c) => c.method)).toEqual(['GET', 'PUT']);
    expect(calls[1].body).toEqual({ supplier: 'Spike Supplier', items: [{ item_code: 'X', qty: 1, rate: 150000 }] });
    expect(result.externalRecordId).toBe('ACC-PINV-2026-00001');
  });

  it('operation:update on a SUBMITTED doc (docstatus 1) routes to amend via routeEdit(1)=amend (FR-ENA-050)', async () => {
    const calls: Array<{ method: string; body?: unknown }> = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined });
      // the routeEdit probe GET
      if (init?.method === 'GET' && calls.length === 1) return jsonResponse(200, { name: 'ACC-PINV-2026-00001', docstatus: 1 });
      if (init?.method === 'PUT' && init.body && JSON.parse(init.body as string).docstatus === 2) return jsonResponse(200, { name: 'ACC-PINV-2026-00001', docstatus: 2 });
      if (init?.method === 'POST') return jsonResponse(200, { name: 'ACC-PINV-2026-00002' });
      if (init?.method === 'PUT') return jsonResponse(200, { name: 'ACC-PINV-2026-00002', docstatus: 1 });
      return jsonResponse(200, { name: 'ACC-PINV-2026-00002', docstatus: 1, amended_from: 'ACC-PINV-2026-00001' });
    };
    const adapter = createErpAdapter(
      baseDeps(fetchImpl, {
        doctypeBodies: { 'purchase-invoice': { toBody: (rec) => ({ supplier: 'Spike Supplier', items: rec.items }), fromDoc: (doc) => ({ id: 'placeholder', vi_number: (doc as { name: string }).name }) } },
      }),
    );
    const result = await adapter.commit({
      domain: 'procurement',
      operation: 'update',
      record: { id: 'pmo-pi-1', erp_doc_kind: 'purchase-invoice', externalRecordId: 'ACC-PINV-2026-00001', items: [{ item_code: 'X', qty: 2 }] },
      idempotencyKey: 'idem-update-1',
    });
    // GET (docstatus 1 -> routeEdit -> amend) -> cancel PUT -> create POST -> submit PUT -> refetch GET
    expect(calls.map((c) => c.method)).toEqual(['GET', 'PUT', 'POST', 'PUT', 'GET']);
    expect(result.externalRecordId).toBe('ACC-PINV-2026-00002');
  });

  it('operation:update on a CANCELLED doc (docstatus 2) is rejected — routeEdit(2) throws (cannot edit cancelled)', async () => {
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      if (init?.method === 'GET') return jsonResponse(200, { name: 'ACC-PINV-2026-00001', docstatus: 2 });
      return jsonResponse(200, {});
    };
    const adapter = createErpAdapter(
      baseDeps(fetchImpl, {
        doctypeBodies: { 'purchase-invoice': { toBody: () => ({}), fromDoc: () => ({ id: 'placeholder' }) } },
      }),
    );
    await expect(
      adapter.commit({ domain: 'procurement', operation: 'update', record: { id: 'pmo-pi-1', erp_doc_kind: 'purchase-invoice', externalRecordId: 'ACC-PINV-2026-00001' } }),
    ).rejects.toMatchObject({ code: 'commit-rejected' });
  });

  it('operation:update on a submittable kind with no externalRecordId is rejected (nothing to edit)', async () => {
    const adapter = createErpAdapter(
      baseDeps(async () => jsonResponse(200, {}), {
        doctypeBodies: { 'purchase-invoice': { toBody: () => ({}), fromDoc: () => ({ id: 'placeholder' }) } },
      }),
    );
    await expect(
      adapter.commit({ domain: 'procurement', operation: 'update', record: { id: 'pmo-pi-1', erp_doc_kind: 'purchase-invoice' } }),
    ).rejects.toMatchObject({ code: 'commit-rejected' });
  });
});

describe('erpnext/adapter — unsupported transition verbs still fail loud', () => {
  it('rejects an unknown verb (only submit/cancel/amend are wired) — loud, never a silent no-op', async () => {
    const adapter = createErpAdapter(
      baseDeps(async () => jsonResponse(200, {}), {
        doctypeBodies: { 'purchase-invoice': { toBody: () => ({}), fromDoc: () => ({ id: 'placeholder' }) } },
      }),
    );
    await expect(
      adapter.commit({ domain: 'procurement', operation: 'transition', record: { id: 'pmo-pi-1', erp_doc_kind: 'purchase-invoice', externalRecordId: 'ACC-PINV-2026-00001', verb: 'unknown' } }),
    ).rejects.toBeInstanceOf(AdapterError);
  });
});
