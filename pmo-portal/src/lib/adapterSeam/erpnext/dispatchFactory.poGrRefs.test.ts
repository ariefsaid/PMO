/**
 * erpnext/dispatchFactory.ts — Slice 5 task 5.3: multi-domain cross-doctype ref resolution for a
 * PO/GR command (FR-ENA-103). A PO command resolves its case's vendor -> the ERP Supplier name
 * (companies domain, `external_refs`) and its case's line items (`procurement_items`) when the
 * caller didn't already supply `record.items`. A GR command additionally resolves the case's PO
 * (`purchase_orders`) -> the ERP PO `name` (procurement domain, `external_refs`) and fetches the PO
 * doc to stamp each line's `po_item_child_name` (the PO item CHILD-ROW `name`) — never a raw PMO id,
 * never a client-supplied ERP name (FR-ENA-103's "never" clause).
 *
 * Guarded on `record.procurementId` being present — a command with none (e.g. every pre-Slice-5 unit
 * test in `dispatchFactory.test.ts`) takes ZERO new DB/HTTP calls, so this file is fully additive and
 * leaves the existing test file untouched.
 */
import { describe, expect, it, vi } from 'vitest';
import { resolveErpDispatchAdapter, type DispatchServiceClient } from './dispatchFactory.ts';

const ACTIVATED_ROW = {
  site_url: 'https://erp.example.com',
  version_major: 15,
  activated_at: '2026-07-11T00:00:00.000Z',
  config: { company: 'PMO Smoke Co' },
};

type TableResponder = unknown | ((filters: Record<string, string>) => unknown);

/** A per-table-branching mock service client: `.from(table).select(cols).eq(...)[.eq(...)][.order(...).limit(...)][.maybeSingle()]`,
 *  and every filter-builder is ALSO directly awaitable (matching real supabase-js's thenable
 *  PostgrestFilterBuilder — resolving to `{data, error}` for a list query with no terminal call). A
 *  table's response may be a plain value OR a `(filters) => rows` function — needed for
 *  `external_refs`, which this mock must branch on the `domain` filter (companies vs procurement). */
function multiTableClient(tables: Record<string, TableResponder>): DispatchServiceClient {
  function filterBuilder(responder: TableResponder, filters: Record<string, string>): unknown {
    const resolveRows = () => (typeof responder === 'function' ? (responder as (f: Record<string, string>) => unknown)(filters) : responder);
    const builder: Record<string, unknown> = {
      eq: (col: string, val: string) => filterBuilder(responder, { ...filters, [col]: val }),
      order: () => filterBuilder(responder, filters),
      limit: () => filterBuilder(responder, filters),
      maybeSingle: async () => {
        const rows = resolveRows();
        return { data: Array.isArray(rows) ? (rows[0] ?? null) : rows, error: null };
      },
      then: (resolve: (v: unknown) => unknown) => resolve({ data: resolveRows(), error: null }),
    };
    return builder;
  }
  return {
    from: (table: string) => ({
      select: () => filterBuilder(tables[table] ?? null, {}) as never,
    }),
  } as unknown as DispatchServiceClient;
}

function erpFetch(poDocItems: Array<{ item_code: string; name: string }>): typeof fetch {
  return (vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return new Response(JSON.stringify({ name: 'MAT-PRE-2026-00001' }), { status: 200 });
    if (init?.method === 'PUT') return new Response(JSON.stringify({ name: 'MAT-PRE-2026-00001', docstatus: 1 }), { status: 200 });
    // GET — either the PO doc fetch (ref resolution) or the post-submit re-fetch; both return
    // enough shape for either purpose.
    return new Response(
      JSON.stringify({ name: 'PUR-ORD-2026-00001', docstatus: 1, items: poDocItems, modified: '2026-07-11 10:00:00.000000' }),
      { status: 200 },
    );
  }) as unknown) as typeof fetch;
}

describe('erpnext/dispatchFactory — Slice 5 PO/GR cross-doctype ref resolution (FR-ENA-103)', () => {
  it('a purchase-order command resolves ctx.refs.supplier from the case vendor via external_refs (companies domain)', async () => {
    const client = multiTableClient({
      external_org_bindings: ACTIVATED_ROW,
      // `org_id` is read by the B10 cross-org link pre-flight (`procurementId` must belong to the
      // caller's org); `vendor_id` by the supplier ref resolution.
      procurements: { org_id: 'org-1', vendor_id: 'company-1' },
      external_refs: [{ external_record_id: 'Supplier:Spike Supplier' }],
      procurement_items: [{ name: 'SPIKE-ITEM-1', quantity: 2, rate: 100000 }],
    });
    const fetchImpl = erpFetch([]);
    const adapter = await resolveErpDispatchAdapter({
      serviceClient: client,
      orgId: 'org-1',
      command: {
        domain: 'procurement',
        operation: 'create',
        record: { id: 'pmo-po-1', procurementId: 'proc-1', erp_doc_kind: 'purchase-order' },
      },
      fetchImpl,
      apiKey: 'k',
      apiSecret: 's',
      doctypeBodies: (await import('./doctypeBodies.ts')).DOCTYPE_BODIES,
    });
    const calls = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    await adapter.commit({
      domain: 'procurement',
      operation: 'create',
      record: { id: 'pmo-po-1', procurementId: 'proc-1', erp_doc_kind: 'purchase-order' },
    });
    const postCall = calls.find(([, init]) => (init as RequestInit)?.method === 'POST');
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body.supplier).toBe('Spike Supplier');
    // resolved from procurement_items (the case's item list) since the command carried none; the
    // command carried no `date` either, so `schedule_date` falls back to the today+7 default (R9 §3
    // mandatory-field rule) — asserted as a shape, not an exact value (non-deterministic across days).
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ item_code: 'SPIKE-ITEM-1', qty: 2, rate: 100000 });
    expect(body.items[0].schedule_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('a goods-receipt command additionally resolves the case PO + the PO-item child-row name (never a raw PMO id)', async () => {
    const client = multiTableClient({
      external_org_bindings: ACTIVATED_ROW,
      // `org_id` is read by the B10 cross-org link pre-flight (`procurementId` must belong to the
      // caller's org); `vendor_id` by the supplier ref resolution.
      procurements: { org_id: 'org-1', vendor_id: 'company-1' },
      // Branches on the `domain` filter — companies -> the supplier mapping, procurement -> the PO's
      // own ERP name (proves the two `external_refs` domains are resolved independently, never conflated).
      external_refs: (filters: Record<string, string>) =>
        filters.domain === 'companies'
          ? [{ external_record_id: 'Supplier:Spike Supplier' }]
          : [{ external_record_id: 'PUR-ORD-2026-00001' }],
      procurement_items: [{ name: 'SPIKE-ITEM-1', quantity: 2, rate: 100000 }],
      purchase_orders: [{ id: 'po-pmo-1' }],
    });
    const fetchImpl = erpFetch([{ item_code: 'SPIKE-ITEM-1', name: 'i7d62dicpp' }]);
    const adapter = await resolveErpDispatchAdapter({
      serviceClient: client,
      orgId: 'org-1',
      command: {
        domain: 'procurement',
        operation: 'create',
        record: { id: 'pmo-gr-1', procurementId: 'proc-1', erp_doc_kind: 'goods-receipt' },
      },
      fetchImpl,
      apiKey: 'k',
      apiSecret: 's',
      doctypeBodies: (await import('./doctypeBodies.ts')).DOCTYPE_BODIES,
    });
    await adapter.commit({
      domain: 'procurement',
      operation: 'create',
      record: { id: 'pmo-gr-1', procurementId: 'proc-1', erp_doc_kind: 'goods-receipt' },
    });
    const calls = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const postCall = calls.find(([, init]) => (init as RequestInit)?.method === 'POST');
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body.supplier).toBe('Spike Supplier');
    expect(body.items).toEqual([
      { item_code: 'SPIKE-ITEM-1', qty: 2, rate: 100000, purchase_order: 'PUR-ORD-2026-00001', purchase_order_item: 'i7d62dicpp' },
    ]);
  });

  it('a command with no procurementId takes zero ref-resolution DB calls (byte-for-byte for every existing caller)', async () => {
    const fromSpy = vi.fn((table: string) => ({
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ACTIVATED_ROW, error: null }) }) }),
      }),
      table,
    }));
    const client = { from: fromSpy } as unknown as DispatchServiceClient;
    await resolveErpDispatchAdapter({
      serviceClient: client,
      orgId: 'org-1',
      command: { domain: 'procurement', operation: 'create', record: { id: 'pmo-po-1', erp_doc_kind: 'purchase-order' } },
      fetchImpl: vi.fn() as unknown as typeof fetch,
      apiKey: 'k',
      apiSecret: 's',
    });
    // exactly ONE call — the binding lookup — no procurements/external_refs/procurement_items queries.
    expect(fromSpy.mock.calls.map((c) => c[0])).toEqual(['external_org_bindings']);
  });
});
