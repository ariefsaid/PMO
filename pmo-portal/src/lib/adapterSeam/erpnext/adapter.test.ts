/**
 * erpnext/adapter.ts — the `tier:'erpnext'`, `capabilityMap:{companies,procurement}` adapter engine
 * (task 2.12). `commit()` dispatches by `record.erp_doc_kind` through the doctype registry; a
 * `submittable` kind gets the R9 two-step create->submit->re-fetch (FR-ENA-044); a non-submittable
 * kind (party) is a single create. The idempotency key is stamped into `remarks` (ADR-0058 §3). No
 * `erp_doc_kind` is actually wired into `DOCTYPE_BODIES` this slice (slices 3-6 wire real bodies) —
 * these tests inject their own fake body-fns to prove the ENGINE, not any specific doctype's shape.
 */
import { describe, expect, it, vi } from 'vitest';
import { AdapterError } from '../contract.ts';
import { createErpAdapter, ERPNEXT_TIER, type ErpAdapterDeps } from './adapter.ts';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function baseDeps(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>, overrides: Partial<ErpAdapterDeps> = {}): ErpAdapterDeps {
  return {
    client: { fetchImpl: vi.fn(fetchImpl) as unknown as typeof fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.com' },
    doctypeBodies: {},
    ctx: { refs: { supplier: 'Spike Supplier' }, config: { company: 'PMO Smoke Co' } },
    ...overrides,
  };
}

describe('erpnext/adapter — capability + tier', () => {
  it('exposes tier="erpnext" and capabilityMap={companies,procurement,revenue,timesheets,budget}', () => {
    const adapter = createErpAdapter(baseDeps(async () => jsonResponse(200, {})));
    expect(adapter.tier).toBe(ERPNEXT_TIER);
    // P3b adds `timesheets` (ADR-0059 Posture B) — additively; the router reads capabilityMap generically.
    // P3c adds `budget` (ADR-0055 §6, also Posture B) — likewise additively.
    expect(adapter.capabilityMap).toEqual(new Set(['companies', 'procurement', 'revenue', 'timesheets', 'budget']));
  });
});

describe('erpnext/adapter — commit() create, submittable kind: two-step create->submit->re-fetch', () => {
  it('FR-ENA-044 POSTs create, PUTs submit, then re-fetches (the stale-status trap) and maps via fromDoc', async () => {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (init?.method === 'POST') return jsonResponse(200, { name: 'PUR-ORD-2026-00001', status: 'Draft' });
      if (init?.method === 'PUT') return jsonResponse(200, { name: 'PUR-ORD-2026-00001', docstatus: 1, status: 'Draft' });
      // the re-fetch — the ONLY place the true post-submit status is returned (R9 §5 stale-status trap).
      return jsonResponse(200, { name: 'PUR-ORD-2026-00001', docstatus: 1, status: 'To Receive and Bill', grand_total: 200000 });
    };
    const deps = baseDeps(fetchImpl, {
      doctypeBodies: {
        'purchase-order': {
          toBody: (rec) => ({ items: rec.items }),
          fromDoc: (doc) => ({ id: 'placeholder', status: (doc as { status: string }).status }),
        },
      },
    });
    const adapter = createErpAdapter(deps);
    const result = await adapter.commit({
      domain: 'procurement',
      operation: 'create',
      record: { id: 'pmo-po-1', erp_doc_kind: 'purchase-order', items: [{ item_code: 'X', qty: 1 }] },
    });

    expect(calls.map((c) => c.method)).toEqual(['POST', 'PUT', 'GET']);
    expect(calls[1].body).toEqual({ docstatus: 1 });
    expect(result.externalRecordId).toBe('PUR-ORD-2026-00001');
    // canonical is the RE-FETCHED status, never the stale POST/PUT response body's "Draft".
    expect(result.canonical).toMatchObject({ id: 'pmo-po-1', status: 'To Receive and Bill' });
  });

  it('ADR-0058 §3 stamps the idempotencyKey into remarks on the create POST body', async () => {
    const calls: Array<{ method: string; body?: unknown }> = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (init?.method === 'POST') return jsonResponse(200, { name: 'ACC-PINV-2026-00002' });
      if (init?.method === 'PUT') return jsonResponse(200, { name: 'ACC-PINV-2026-00002', docstatus: 1 });
      return jsonResponse(200, { name: 'ACC-PINV-2026-00002', docstatus: 1, grand_total: 150000 });
    };
    const deps = baseDeps(fetchImpl, {
      doctypeBodies: {
        'purchase-invoice': { toBody: (rec) => ({ supplier: 'Spike Supplier', items: rec.items }), fromDoc: () => ({ id: 'placeholder' }) },
      },
    });
    const adapter = createErpAdapter(deps);
    await adapter.commit({
      domain: 'procurement',
      operation: 'create',
      record: { id: 'pmo-pi-1', erp_doc_kind: 'purchase-invoice', items: [{ item_code: 'X', qty: 1 }] },
      idempotencyKey: 'idem-key-123',
    });
    expect((calls[0].body as { remarks?: string }).remarks).toBe('idem-key-123');
  });

  it('calls afterSubmitHook right after submit, before the re-fetch (FR-ENA-003 after-submit-before-mirror seam)', async () => {
    const order: string[] = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse(200, { name: 'PUR-ORD-2026-00001' });
      if (init?.method === 'PUT') {
        order.push('submit');
        return jsonResponse(200, { name: 'PUR-ORD-2026-00001', docstatus: 1 });
      }
      order.push('refetch');
      return jsonResponse(200, { name: 'PUR-ORD-2026-00001', docstatus: 1 });
    };
    const afterSubmitHook = vi.fn(async () => {
      order.push('hook');
    });
    const deps = baseDeps(fetchImpl, {
      afterSubmitHook,
      doctypeBodies: { 'purchase-order': { toBody: (rec) => ({ items: rec.items }), fromDoc: () => ({ id: 'placeholder' }) } },
    });
    const adapter = createErpAdapter(deps);
    await adapter.commit({ domain: 'procurement', operation: 'create', record: { id: 'pmo-po-2', erp_doc_kind: 'purchase-order', items: [{ item_code: 'X', qty: 1 }] } });
    expect(afterSubmitHook).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['submit', 'hook', 'refetch']);
  });
});

describe('erpnext/adapter — commit() create, non-submittable kind: single create, no submit/refetch', () => {
  it('POSTs create only (a party has no docstatus lifecycle)', async () => {
    const calls: string[] = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      calls.push(init?.method ?? 'GET');
      return jsonResponse(200, { name: 'Spike Supplier' });
    };
    const deps = baseDeps(fetchImpl, {
      doctypeBodies: { supplier: { toBody: (rec) => ({ supplier_name: rec.supplier_name }), fromDoc: (doc) => ({ id: 'placeholder', erp_supplier_name: (doc as { name: string }).name }) } },
    });
    const adapter = createErpAdapter(deps);
    const result = await adapter.commit({ domain: 'companies', operation: 'create', record: { id: 'pmo-c-1', erp_doc_kind: 'supplier', supplier_name: 'Spike Supplier' } });
    expect(calls).toEqual(['POST']);
    // The wire-level externalRecordId is the BARE ERP name (AC-ENA-040 live-bench proof: Supplier
    // autonames by field:supplier_name) — the "<Doctype>:<name>" collision-safe encoding
    // (partyAdopt.ts's externalIdFor, task 3.2) is applied only at the external_refs WRITE (index.ts's
    // recordExternalRef wrapper, task 6.4 fix-round), never on the adapter's own return value.
    expect(result.externalRecordId).toBe('Spike Supplier');
    expect(result.canonical).toMatchObject({ id: 'pmo-c-1', erp_supplier_name: 'Spike Supplier' });
  });
});

describe('erpnext/adapter — commit() update, non-submittable kind (task 3.3, FR-ENA-092): a party has no docstatus, so update is a direct field PUT', () => {
  it('resolves the target ERP name from ctx.refs.self, PUTs the toBody patch directly (no submit/re-fetch), maps via fromDoc', async () => {
    const calls: Array<{ method: string; body?: unknown; url: string }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined, url });
      return jsonResponse(200, { name: 'Spike Supplier', supplier_name: 'Spike Supplier Renamed' });
    };
    const deps = baseDeps(fetchImpl, {
      ctx: { refs: { self: 'Spike Supplier' }, config: {} },
      doctypeBodies: {
        supplier: {
          toBody: (rec) => ({ supplier_name: rec.name }),
          fromDoc: (doc) => ({ id: 'placeholder', erp_supplier_name: (doc as { supplier_name: string }).supplier_name }),
        },
      },
    });
    const adapter = createErpAdapter(deps);
    const result = await adapter.commit({
      domain: 'companies',
      operation: 'update',
      record: { id: 'pmo-co-1', erp_doc_kind: 'supplier', name: 'Spike Supplier Renamed' },
    });
    expect(calls).toEqual([{ method: 'PUT', body: { supplier_name: 'Spike Supplier Renamed' }, url: 'https://erp.example.com/api/resource/Supplier/Spike%20Supplier' }]);
    // Bare ERP name on the wire, consistent with the create path (see that test's comment).
    expect(result.externalRecordId).toBe('Spike Supplier');
    expect(result.canonical).toMatchObject({ id: 'pmo-co-1', erp_supplier_name: 'Spike Supplier Renamed' });
  });

  it('rejects an update with no resolved ctx.refs.self (cannot target an unknown ERP doc)', async () => {
    const deps = baseDeps(async () => jsonResponse(200, {}), {
      doctypeBodies: { supplier: { toBody: () => ({}), fromDoc: () => ({ id: 'placeholder' }) } },
    });
    const adapter = createErpAdapter(deps);
    await expect(
      adapter.commit({ domain: 'companies', operation: 'update', record: { id: 'pmo-co-1', erp_doc_kind: 'supplier' } }),
    ).rejects.toMatchObject({ code: 'commit-rejected' });
  });
});

describe('erpnext/adapter — un-wired kinds/operations fail loud, never a silent no-op', () => {
  it('rejects a command whose erp_doc_kind has no DOCTYPE_BODIES entry yet', async () => {
    const adapter = createErpAdapter(baseDeps(async () => jsonResponse(200, {})));
    await expect(
      adapter.commit({ domain: 'procurement', operation: 'create', record: { id: 'pmo-1', erp_doc_kind: 'purchase-request' } }),
    ).rejects.toMatchObject({ code: 'commit-rejected' });
  });

  it('rejects a record with a missing/unknown erp_doc_kind', async () => {
    const adapter = createErpAdapter(baseDeps(async () => jsonResponse(200, {})));
    await expect(adapter.commit({ domain: 'procurement', operation: 'create', record: { id: 'pmo-1' } })).rejects.toBeInstanceOf(AdapterError);
  });

  it('update on a SUBMITTABLE kind now routes via routeEdit (task 6.3) — a missing externalRecordId is rejected loud (nothing to edit)', async () => {
    const deps = baseDeps(async () => jsonResponse(200, {}), {
      doctypeBodies: { 'purchase-order': { toBody: () => ({}), fromDoc: () => ({ id: 'placeholder' }) } },
    });
    const adapter = createErpAdapter(deps);
    await expect(
      adapter.commit({ domain: 'procurement', operation: 'update', record: { id: 'pmo-1', erp_doc_kind: 'purchase-order' } }),
    ).rejects.toMatchObject({ code: 'commit-rejected' });
  });

  it('transition is not yet wired this slice (any kind) — loud throw, never a silent no-op', async () => {
    const deps = baseDeps(async () => jsonResponse(200, {}), {
      doctypeBodies: { supplier: { toBody: () => ({}), fromDoc: () => ({ id: 'placeholder' }) } },
    });
    const adapter = createErpAdapter(deps);
    await expect(
      adapter.commit({ domain: 'companies', operation: 'transition', record: { id: 'pmo-1', erp_doc_kind: 'supplier' } }),
    ).rejects.toMatchObject({ code: 'commit-rejected' });
  });

  it('delete is never supported (OQ-8: cancel-only, never delete)', async () => {
    const adapter = createErpAdapter(baseDeps(async () => jsonResponse(200, {})));
    await expect(
      adapter.commit({ domain: 'companies', operation: 'delete', record: { id: 'pmo-1', erp_doc_kind: 'supplier' } }),
    ).rejects.toMatchObject({ code: 'commit-rejected' });
  });
});

describe('erpnext/adapter — reads (listChangesSinceWatermark deferred to slice 8)', () => {
  it('listChangesSinceWatermark throws loud (not yet wired until the slice-8 modified-poll sweep)', async () => {
    const adapter = createErpAdapter(baseDeps(async () => jsonResponse(200, {})));
    await expect(adapter.listChangesSinceWatermark('procurement', null)).rejects.toThrow(/slice 8/);
  });

  it('getByExternalId resolves a "<Doctype>:<name>"-encoded id via the registry + doctypeBodies.fromDoc', async () => {
    const fetchImpl = async () => jsonResponse(200, { name: 'Spike Supplier', supplier_name: 'Spike Supplier' });
    const deps = baseDeps(fetchImpl, {
      doctypeBodies: { supplier: { toBody: () => ({}), fromDoc: (doc) => ({ id: 'placeholder', erp_supplier_name: (doc as { supplier_name: string }).supplier_name }) } },
    });
    const adapter = createErpAdapter(deps);
    const record = await adapter.getByExternalId('companies', 'Supplier:Spike Supplier');
    expect(record).toMatchObject({ erp_supplier_name: 'Spike Supplier' });
  });

  it('getByExternalId returns null for a 404 (not found)', async () => {
    const fetchImpl = async () => jsonResponse(404, { exc_type: 'DoesNotExistError' });
    const deps = baseDeps(fetchImpl, { doctypeBodies: { supplier: { toBody: () => ({}), fromDoc: () => ({ id: 'placeholder' }) } } });
    const adapter = createErpAdapter(deps);
    await expect(adapter.getByExternalId('companies', 'Supplier:Ghost')).resolves.toBeNull();
  });
});
