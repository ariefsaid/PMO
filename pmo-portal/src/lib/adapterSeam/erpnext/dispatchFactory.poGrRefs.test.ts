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
      select: () => filterBuilder(tables[table] ?? (table === 'procurement_erp_links' ? [] : null), {}) as never,
    }),
  } as unknown as DispatchServiceClient;
}

function erpFetch(poDocItems: Array<{ item_code: string; name: string }>, itemNames: string[] = ['SPIKE-ITEM-1']): typeof fetch {
  return (vi.fn(async (_url: string, init?: RequestInit) => {
    if (new URL(_url).pathname === '/api/resource/Item') return Response.json({ data: itemNames.map((name) => ({ name, item_name: 'Test item', disabled: 0, is_sales_item: 1, is_purchase_item: 1 })) });
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

  // PD-ECA-5 / ECA2-T15: an accepted item link writes config.item_map[<line name>] = <ERP item code>.
  async function purchaseOrderBody(config: Record<string, unknown>, lines: Array<{ name: string; quantity: number; rate: number }>, itemNames: string[]) {
    const client = multiTableClient({
      external_org_bindings: { ...ACTIVATED_ROW, config: { ...ACTIVATED_ROW.config, ...config } },
      procurements: { org_id: 'org-1', vendor_id: 'company-1' },
      external_refs: [{ external_record_id: 'Supplier:Spike Supplier' }],
      procurement_items: lines,
    });
    const fetchImpl = erpFetch([], itemNames);
    const command = { domain: 'procurement' as const, operation: 'create' as const, record: { id: 'pmo-po-1', procurementId: 'proc-1', erp_doc_kind: 'purchase-order' } };
    const adapter = await resolveErpDispatchAdapter({
      serviceClient: client, orgId: 'org-1', command, fetchImpl, apiKey: 'k', apiSecret: 's',
      doctypeBodies: (await import('./doctypeBodies.ts')).DOCTYPE_BODIES,
    });
    await adapter.commit(command);
    const calls = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const post = calls.find(([, init]) => (init as RequestInit)?.method === 'POST');
    return JSON.parse((post![1] as RequestInit).body as string) as { items: Array<{ item_code: string }> };
  }

  it('ECA2-T15 a line whose name is in the binding item map goes to the mapped ERP item code', async () => {
    const body = await purchaseOrderBody({ item_map: { 'Semen 50 kg': 'SMN-50' } }, [{ name: 'Semen 50 kg', quantity: 3, rate: 70000 }], ['SMN-50']);
    expect(body.items.map((i) => i.item_code)).toEqual(['SMN-50']);
  });

  it('ECA2-T15 a line absent from the map keeps its own name as the item code', async () => {
    const body = await purchaseOrderBody({ item_map: { 'Semen 50 kg': 'SMN-50' } }, [{ name: 'Pasir', quantity: 1, rate: 1 }, { name: 'Semen 50 kg', quantity: 1, rate: 1 }], ['Pasir', 'SMN-50']);
    expect(body.items.map((i) => i.item_code)).toEqual(['Pasir', 'SMN-50']);
  });

  it('Minor 3 a line named like a JavaScript built-in keeps its own name as the item code', async () => {
    const body = await purchaseOrderBody({ item_map: { Pasir: 'PSR-1' } }, [{ name: 'toString', quantity: 1, rate: 1 }, { name: 'constructor', quantity: 1, rate: 1 }], ['toString', 'constructor']);
    expect(body.items.map((i) => i.item_code)).toEqual(['toString', 'constructor']);
  });

  it('ECA2-T15 no item map at all changes nothing', async () => {
    const body = await purchaseOrderBody({}, [{ name: 'SPIKE-ITEM-1', quantity: 1, rate: 1 }], ['SPIKE-ITEM-1']);
    expect(body.items.map((i) => i.item_code)).toEqual(['SPIKE-ITEM-1']);
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

  it('uses the linked ERP order for a new goods receipt', async () => {
    const client = multiTableClient({
      external_org_bindings: ACTIVATED_ROW,
      procurements: { org_id: 'org-1', vendor_id: 'company-1' },
      external_refs: [{ external_record_id: 'Supplier:Spike Supplier' }],
      procurement_items: [{ name: 'SPIKE-ITEM-1', quantity: 2, rate: 100000 }],
      purchase_orders: [],
      procurement_erp_links: [{ erp_purchase_documents: { erp_name: 'PUR-ORD-2026-00001', erp_doctype: 'Purchase Order' } }],
    });
    const fetchImpl = erpFetch([{ item_code: 'SPIKE-ITEM-1', name: 'item-ref' }]);
    const command = { domain: 'procurement' as const, operation: 'create' as const,
      record: { id: 'pmo-gr-1', procurementId: 'proc-1', erp_doc_kind: 'goods-receipt' } };
    const adapter = await resolveErpDispatchAdapter({ serviceClient: client, orgId: 'org-1', command,
      fetchImpl, apiKey: 'k', apiSecret: 's', doctypeBodies: (await import('./doctypeBodies.ts')).DOCTYPE_BODIES });
    await adapter.commit(command);
    const calls = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const post = calls.find(([, init]) => (init as RequestInit)?.method === 'POST');
    const body = JSON.parse((post![1] as RequestInit).body as string);
    expect(body.items[0]).toMatchObject({ purchase_order: 'PUR-ORD-2026-00001', purchase_order_item: 'item-ref' });
  });

  it('refuses ambiguous linked purchase orders before sending a receipt', async () => {
    const client = multiTableClient({
      external_org_bindings: ACTIVATED_ROW,
      procurements: { org_id: 'org-1', vendor_id: 'company-1' },
      external_refs: [{ external_record_id: 'Supplier:Spike Supplier' }],
      procurement_items: [{ name: 'SPIKE-ITEM-1', quantity: 1, rate: 10 }],
      purchase_orders: [],
      procurement_erp_links: [
        { erp_purchase_documents: { erp_name: 'PO-1' } },
        { erp_purchase_documents: { erp_name: 'PO-2' } },
      ],
    });
    const command = { domain: 'procurement' as const, operation: 'create' as const,
      record: { id: 'pmo-gr-1', procurementId: 'proc-1', erp_doc_kind: 'goods-receipt' } };
    const fetchImpl = erpFetch([]);
    await expect(resolveErpDispatchAdapter({ serviceClient: client, orgId: 'org-1', command,
      fetchImpl, apiKey: 'k', apiSecret: 's', doctypeBodies: (await import('./doctypeBodies.ts')).DOCTYPE_BODIES }))
      .rejects.toThrow('More than one linked purchase order is available.');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uses the linked order for supplied receipt lines', async () => {
    const client = multiTableClient({
      external_org_bindings: ACTIVATED_ROW,
      procurements: { org_id: 'org-1', vendor_id: 'company-1' },
      external_refs: [{ external_record_id: 'Supplier:Spike Supplier' }],
      purchase_orders: [],
      procurement_erp_links: [{ erp_purchase_documents: { erp_name: 'PUR-ORD-2026-00001' } }],
    });
    const command = { domain: 'procurement' as const, operation: 'create' as const,
      record: { id: 'pmo-gr-1', procurementId: 'proc-1', erp_doc_kind: 'goods-receipt',
        items: [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 10 }] } };
    const fetchImpl = erpFetch([{ item_code: 'SPIKE-ITEM-1', name: 'item-ref' }]);
    const adapter = await resolveErpDispatchAdapter({ serviceClient: client, orgId: 'org-1', command,
      fetchImpl, apiKey: 'k', apiSecret: 's', doctypeBodies: (await import('./doctypeBodies.ts')).DOCTYPE_BODIES });
    await adapter.commit(command);
    const post = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST');
    expect(JSON.parse((post![1] as RequestInit).body as string).items[0]).toMatchObject({
      purchase_order: 'PUR-ORD-2026-00001', purchase_order_item: 'item-ref',
    });
  });

  it('freezes goods receipt lines with their purchase-order item references', async () => {
    const client = multiTableClient({
      external_org_bindings: ACTIVATED_ROW,
      procurements: { org_id: 'org-1', vendor_id: 'company-1' },
      external_refs: (filters: Record<string, string>) => filters.domain === 'companies'
        ? [{ external_record_id: 'Supplier:Spike Supplier' }]
        : [{ external_record_id: 'PUR-ORD-2026-00001' }],
      procurement_items: [{ name: 'SPIKE-ITEM-1', description: 'Service', quantity: 2, rate: 100000 }],
      purchase_orders: [{ id: 'po-pmo-1' }],
    });
    const command = { domain: 'procurement' as const, operation: 'create' as const,
      record: { id: 'pmo-gr-1', procurementId: 'proc-1', erp_doc_kind: 'goods-receipt' } };
    const capture = vi.fn();
    await resolveErpDispatchAdapter({ serviceClient: client, orgId: 'org-1', command,
      fetchImpl: erpFetch([{ item_code: 'SPIKE-ITEM-1', name: 'item-ref' }]), apiKey: 'k', apiSecret: 's',
      captureProcurementSourceLines: capture,
      doctypeBodies: (await import('./doctypeBodies.ts')).DOCTYPE_BODIES });
    expect(command.record).toMatchObject({ items: [{ item_code: 'SPIKE-ITEM-1', description: 'Service', qty: 2, rate: 100000, po_item_child_name: 'item-ref' }] });
    expect(capture).toHaveBeenCalledWith([{ name: 'SPIKE-ITEM-1', description: 'Service', quantity: 2, rate: 100000 }]);
  });

  it('replays a persisted goods receipt with its original supplier and order links', async () => {
    const client = multiTableClient({
      external_org_bindings: ACTIVATED_ROW,
      procurements: { org_id: 'org-1', vendor_id: 'company-1' },
      external_refs: [{ external_record_id: 'Supplier:Changed Supplier' }],
      procurement_items: [{ name: 'CHANGED', quantity: 8, rate: 9 }],
      purchase_orders: [{ id: 'new-po' }],
    });
    const command = { domain: 'procurement' as const, operation: 'create' as const,
      record: { id: 'pmo-gr-1', procurementId: 'proc-1', erp_doc_kind: 'goods-receipt',
        items: [{ item_code: 'SPIKE-ITEM-1', qty: 2, rate: 100000, po_item_child_name: 'item-ref' }],
        pmo_gr_snapshot: { supplier: 'Spike Supplier', po: 'PUR-ORD-2026-00001', raw_digest: 'witness' } } };
    const fetchImpl = erpFetch([]);
    const adapter = await resolveErpDispatchAdapter({ serviceClient: client, orgId: 'org-1', command,
      fetchImpl, apiKey: 'k', apiSecret: 's', replay: true, trustedReceiptSnapshot: true,
      doctypeBodies: (await import('./doctypeBodies.ts')).DOCTYPE_BODIES });
    await adapter.commit(command);
    const post = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST');
    const body = JSON.parse((post![1] as RequestInit).body as string);
    expect(body.supplier).toBe('Spike Supplier');
    expect(body.items).toEqual([{ item_code: 'SPIKE-ITEM-1', qty: 2, rate: 100000, purchase_order: 'PUR-ORD-2026-00001', purchase_order_item: 'item-ref' }]);
  });

  it('does not treat a legacy payload property as a server snapshot', async () => {
    const client = multiTableClient({ external_org_bindings: ACTIVATED_ROW,
      procurements: { org_id: 'org-1', vendor_id: 'company-1' },
      external_refs: [{ external_record_id: 'Supplier:Current Supplier' }],
      procurement_items: [{ name: 'SPIKE-ITEM-1', quantity: 1, rate: 10 }], purchase_orders: [] });
    const command = { domain: 'procurement' as const, operation: 'create' as const,
      record: { id: 'pmo-gr-1', procurementId: 'proc-1', erp_doc_kind: 'goods-receipt',
        pmo_gr_snapshot: { supplier: 'Caller supplied', po: 'Caller supplied PO', raw_digest: 'caller' } } };
    const fetchImpl = erpFetch([]);
    const adapter = await resolveErpDispatchAdapter({ serviceClient: client, orgId: 'org-1', command,
      fetchImpl, apiKey: 'k', apiSecret: 's', replay: true,
      doctypeBodies: (await import('./doctypeBodies.ts')).DOCTYPE_BODIES });
    await adapter.commit(command);
    const post = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST');
    expect(JSON.parse((post![1] as RequestInit).body as string).supplier).toBe('Current Supplier');
  });

  it('keeps an absent supplier absent in a verified receipt snapshot', async () => {
    const client = multiTableClient({ external_org_bindings: ACTIVATED_ROW,
      procurements: { org_id: 'org-1', vendor_id: 'company-1' },
      companies: { id: 'company-1', org_id: 'org-1' },
      external_refs: [{ external_record_id: 'Supplier:Changed Supplier' }] });
    const command = { domain: 'procurement' as const, operation: 'create' as const,
      record: { id: 'pmo-gr-1', procurementId: 'proc-1', vendorId: 'company-1', erp_doc_kind: 'goods-receipt',
        items: [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 10 }], pmo_gr_snapshot: { supplier: null, po: null } } };
    const fetchImpl = erpFetch([]);
    const adapter = await resolveErpDispatchAdapter({ serviceClient: client, orgId: 'org-1', command,
      fetchImpl, apiKey: 'k', apiSecret: 's', replay: true, trustedReceiptSnapshot: true,
      doctypeBodies: (await import('./doctypeBodies.ts')).DOCTYPE_BODIES });
    await adapter.commit(command);
    const post = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST');
    expect(JSON.parse((post![1] as RequestInit).body as string).supplier).toBeNull();
  });

  it('freezes the supplier when a receipt supplies its own items', async () => {
    const client = multiTableClient({ external_org_bindings: ACTIVATED_ROW,
      procurements: { org_id: 'org-1', vendor_id: 'company-1' },
      external_refs: [{ external_record_id: 'Supplier:Original Supplier' }] });
    const command = { domain: 'procurement' as const, operation: 'create' as const,
      record: { id: 'pmo-gr-1', procurementId: 'proc-1', erp_doc_kind: 'goods-receipt',
        items: [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 10 }] } };
    await resolveErpDispatchAdapter({ serviceClient: client, orgId: 'org-1', command,
      fetchImpl: erpFetch([]), apiKey: 'k', apiSecret: 's',
      doctypeBodies: (await import('./doctypeBodies.ts')).DOCTYPE_BODIES });
    expect(command.record).toMatchObject({ pmo_gr_snapshot: { supplier: 'Original Supplier', po: null } });
  });

  it('refuses a case command when its source lines cannot be read', async () => {
    const base = multiTableClient({ external_org_bindings: ACTIVATED_ROW,
      procurements: { org_id: 'org-1', vendor_id: null }, external_refs: [], purchase_orders: [] });
    const client = { ...base, from: (table: string) => table === 'procurement_items'
      ? { select: () => ({ eq: () => Promise.resolve({ data: null, error: { message: 'source unavailable', code: 'XX000' } }) }) }
      : base.from(table) } as unknown as DispatchServiceClient;
    const command = { domain: 'procurement' as const, operation: 'create' as const,
      record: { id: 'pmo-gr-1', procurementId: 'proc-1', erp_doc_kind: 'goods-receipt' } };
    await expect(resolveErpDispatchAdapter({ serviceClient: client, orgId: 'org-1', command,
      fetchImpl: erpFetch([]), apiKey: 'k', apiSecret: 's', captureProcurementSourceLines: vi.fn(),
      doctypeBodies: (await import('./doctypeBodies.ts')).DOCTYPE_BODIES })).rejects.toThrow('source unavailable');
  });

  // A vendor bill names its ERP order line on every line the order carries, so ERPNext reads the order
  // (and its receipts) billed; PMO refuses what ERPNext would only refuse after leaving a draft.
  describe('vendor bill order lines', () => {
    type OrderLine = { item_code: string; name: string; amount: number; billed_amt: number; qty?: number; rate?: number };
    const LINE: OrderLine = { item_code: 'SPIKE-ITEM-1', name: 'po-line-1', amount: 400, billed_amt: 0, qty: 4, rate: 100 };

    function billFetch(lines: OrderLine[], order: Record<string, unknown> = {}) {
      return vi.fn(async (url: string, init?: RequestInit) => {
        const path = decodeURIComponent(new URL(url).pathname);
        if (path === '/api/resource/Item') return Response.json({ data: ['SPIKE-ITEM-1', 'FREIGHT'].map((name) => ({ name, item_name: 'Test item', disabled: 0, is_sales_item: 1, is_purchase_item: 1 })) });
        if (path.startsWith('/api/resource/Purchase Order/')) {
          return Response.json({ data: { name: 'PUR-ORD-2026-00001', docstatus: 1, transaction_date: '2026-07-01', items: lines, ...order } });
        }
        if (init?.method === 'POST') return new Response(JSON.stringify({ name: 'ACC-PINV-2026-00001' }), { status: 200 });
        if (init?.method === 'PUT') return new Response(JSON.stringify({ name: 'ACC-PINV-2026-00001', docstatus: 1 }), { status: 200 });
        return Response.json({ data: [] });
      }) as unknown as typeof fetch;
    }

    function billClient(opts: { mapped?: boolean; noOrder?: boolean; qty?: number; rate?: number; version?: number } = {}) {
      return multiTableClient({
        external_org_bindings: { ...ACTIVATED_ROW, version_major: opts.version ?? 15 },
        procurements: { org_id: 'org-1', vendor_id: 'company-1' },
        external_refs: (filters: Record<string, string>) => filters.domain === 'companies'
          ? [{ external_record_id: 'Supplier:Spike Supplier' }]
          : opts.mapped ? [{ external_record_id: 'PUR-ORD-2026-00001' }] : [],
        procurement_items: [{ name: 'SPIKE-ITEM-1', quantity: opts.qty ?? 2, rate: opts.rate ?? 100 }],
        purchase_orders: opts.mapped ? [{ id: 'po-pmo-1' }] : [],
        procurement_erp_links: opts.mapped || opts.noOrder ? [] : [{ erp_purchase_documents: { erp_name: 'PUR-ORD-2026-00001', erp_doctype: 'Purchase Order' } }],
      });
    }

    async function adapterFor(client: DispatchServiceClient, fetchImpl: typeof fetch, replay = false, items?: Array<Record<string, unknown>>) {
      const command = { domain: 'procurement' as const, operation: 'create' as const,
        record: { id: 'pmo-pi-1', procurementId: 'proc-1', erp_doc_kind: 'purchase-invoice', ...(items ? { items } : {}) } };
      const adapter = await resolveErpDispatchAdapter({ serviceClient: client, orgId: 'org-1', command, replay,
        fetchImpl, apiKey: 'k', apiSecret: 's', doctypeBodies: (await import('./doctypeBodies.ts')).DOCTYPE_BODIES });
      return { adapter, command };
    }

    const writes = (fetchImpl: typeof fetch) => (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .filter(([, init]) => ['POST', 'PUT'].includes((init as RequestInit | undefined)?.method ?? 'GET'));

    async function sentBillItems(client: DispatchServiceClient, fetchImpl: typeof fetch) {
      const { adapter, command } = await adapterFor(client, fetchImpl);
      await adapter.commit(command);
      const post = writes(fetchImpl).find(([, init]) => (init as RequestInit).method === 'POST')!;
      return JSON.parse((post[1] as RequestInit).body as string).items as Array<Record<string, unknown>>;
    }

    it('a bill on the linked ERP order carries the order and its line', async () => {
      const items = await sentBillItems(billClient(), billFetch([LINE]));
      expect(items[0]).toMatchObject({ item_code: 'SPIKE-ITEM-1', purchase_order: 'PUR-ORD-2026-00001', po_detail: 'po-line-1' });
    });

    it('a bill on the order PMO pushed carries the order and its line', async () => {
      const items = await sentBillItems(billClient({ mapped: true }), billFetch([LINE]));
      expect(items[0]).toMatchObject({ purchase_order: 'PUR-ORD-2026-00001', po_detail: 'po-line-1' });
    });

    it('a bill for a purchase with no ERP order is sent as before, with no ERP order read', async () => {
      const client = multiTableClient({
        external_org_bindings: ACTIVATED_ROW,
        procurements: { org_id: 'org-1', vendor_id: 'company-1' },
        external_refs: [{ external_record_id: 'Supplier:Spike Supplier' }],
        procurement_items: [{ name: 'SPIKE-ITEM-1', quantity: 2, rate: 100 }],
        purchase_orders: [], procurement_erp_links: [],
      });
      const fetchImpl = billFetch([LINE]);
      const items = await sentBillItems(client, fetchImpl);
      expect(items[0]).not.toHaveProperty('po_detail');
      expect(items[0]).not.toHaveProperty('purchase_order');
    });

    it('refuses a bill none of whose lines is on the order, before any ERP write', async () => {
      const fetchImpl = billFetch([{ ...LINE, item_code: 'OTHER' }]);
      await expect(adapterFor(billClient(), fetchImpl)).rejects.toThrow(/No line of this bill is on ERP order PUR-ORD-2026-00001/);
      expect(writes(fetchImpl)).toHaveLength(0);
    });

    it('refuses a bill whose item is on two order lines, before any ERP write', async () => {
      const fetchImpl = billFetch([LINE, { ...LINE, name: 'po-line-2' }]);
      await expect(adapterFor(billClient(), fetchImpl)).rejects.toThrow(/has SPIKE-ITEM-1 on more than one line/);
      expect(writes(fetchImpl)).toHaveLength(0);
    });

    // One item on two order lines: the bill line takes the order line with the same rate AND quantity, never a guess.
    // (PMO's line order is not provably the ERP order's line order: the case lines are read without an ORDER BY, so a position tie-break is not offered.)
    const TWO = (a: Partial<OrderLine>, b: Partial<OrderLine>): OrderLine[] => [
      { ...LINE, name: 'po-line-1', qty: 2, rate: 100, amount: 200, ...a }, { ...LINE, name: 'po-line-2', qty: 2, rate: 100, amount: 200, ...b }];

    it('a bill line whose item is on two order lines at different rates is billed against the line with its rate', async () => {
      const items = await sentBillItems(billClient({ qty: 2, rate: 150 }), billFetch(TWO({}, { rate: 150, amount: 300 })));
      expect(items[0]).toMatchObject({ purchase_order: 'PUR-ORD-2026-00001', po_detail: 'po-line-2' });
      const first = await sentBillItems(billClient({ qty: 2, rate: 100 }), billFetch(TWO({}, { rate: 150, amount: 300 })));
      expect(first[0]).toMatchObject({ po_detail: 'po-line-1' });
    });

    it('a bill line whose item is on two order lines at the same rate and different quantities is billed against the line with its quantity', async () => {
      const items = await sentBillItems(billClient({ qty: 5, rate: 100 }), billFetch(TWO({}, { qty: 5, amount: 500 })));
      expect(items[0]).toMatchObject({ po_detail: 'po-line-2' });
    });

    it('refuses a bill line whose item is on two order lines with the same rate and quantity, before any ERP write', async () => {
      const fetchImpl = billFetch(TWO({}, {}));
      await expect(adapterFor(billClient({ qty: 2, rate: 100 }), fetchImpl)).rejects.toThrow(/has SPIKE-ITEM-1 on more than one line; PMO cannot tell which one this bill settles/);
      expect(writes(fetchImpl)).toHaveLength(0);
    });

    it('refuses a bill line whose item is on two order lines and matches neither in rate and quantity, before any ERP write', async () => {
      const fetchImpl = billFetch(TWO({}, { rate: 150, amount: 300 }));
      await expect(adapterFor(billClient({ qty: 2, rate: 120 }), fetchImpl)).rejects.toThrow(/on more than one line/);
      expect(writes(fetchImpl)).toHaveLength(0);
    });

    it('the amount left is checked on the chosen order line, not the other one', async () => {
      const fetchImpl = billFetch(TWO({}, { rate: 150, amount: 300, billed_amt: 200 }));
      await expect(adapterFor(billClient({ qty: 2, rate: 150 }), fetchImpl)).rejects.toThrow(/has 100\.00 left to bill for SPIKE-ITEM-1; this bill asks 300\.00/);
      expect(writes(fetchImpl)).toHaveLength(0);
    });

    it('refuses a bill above what is left to bill on its order line, before any ERP write', async () => {
      const fetchImpl = billFetch([{ ...LINE, amount: 400, billed_amt: 300 }]);
      await expect(adapterFor(billClient({ qty: 2, rate: 100 }), fetchImpl)).rejects.toThrow(/has 100\.00 left to bill for SPIKE-ITEM-1; this bill asks 200\.00/);
      expect(writes(fetchImpl)).toHaveLength(0);
    });

    it('refuses two bill lines that are each under what is left but together over, before any ERP write', async () => {
      const fetchImpl = billFetch([{ ...LINE, amount: 400, billed_amt: 0 }]);
      const items = [{ item_code: 'SPIKE-ITEM-1', qty: 3, rate: 100 }, { item_code: 'SPIKE-ITEM-1', qty: 3, rate: 100 }];
      await expect(adapterFor(billClient(), fetchImpl, false, items)).rejects.toThrow(/has 400\.00 left to bill for SPIKE-ITEM-1; this bill asks 600\.00/);
      expect(writes(fetchImpl)).toHaveLength(0);
    });

    it('a line that is not on the order never carries an order reference the caller sent', async () => {
      const fetchImpl = billFetch([LINE]);
      const items = [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 100 },
        { item_code: 'FREIGHT', qty: 1, rate: 10, po_item_child_name: 'foreign-line', po_detail: 'foreign-line', purchase_order: 'PUR-ORD-OTHER' }];
      const { adapter, command } = await adapterFor(billClient(), fetchImpl, false, items);
      await adapter.commit(command);
      const post = writes(fetchImpl).find(([, init]) => (init as RequestInit).method === 'POST')!;
      const sent = JSON.parse((post[1] as RequestInit).body as string).items as Array<Record<string, unknown>>;
      expect(sent[0]).toMatchObject({ po_detail: 'po-line-1' });
      expect(sent[1]).toMatchObject({ item_code: 'FREIGHT' });
      expect(sent[1]).not.toHaveProperty('po_detail');
      expect(sent[1]).not.toHaveProperty('purchase_order');
    });

    // Which refusal a bad line gets: no rate (null/missing) -> the unpriced-lines one; no usable quantity (null/missing/non-numeric)
    // -> the items-total one (both already existed for the entered-tax path); everything else (qty <= 0, rate < 0, blank) -> the bill-line one.
    const refusalOf = (line: { qty?: unknown; rate?: unknown }): RegExp => {
      if (line.rate == null) return /unpriced lines/;
      if (line.qty == null || !Number.isFinite(Number(line.qty))) return /missing its quantity/;
      return /quantity and rate must be numbers/;
    };

    it('refuses a linked line whose qty or rate is not a number, before any ERP write', async () => {
      for (const bad of [{ item_code: 'SPIKE-ITEM-1', qty: 1 }, { item_code: 'SPIKE-ITEM-1', qty: 'x', rate: 100 }]) {
        const fetchImpl = billFetch([LINE]);
        await expect(adapterFor(billClient(), fetchImpl, false, [bad])).rejects.toThrow(refusalOf(bad));
        expect(writes(fetchImpl)).toHaveLength(0);
      }
    });

    it('refuses a linked line whose qty is not above zero or whose rate is below zero, null or empty, before any ERP write', async () => {
      const bads = [{ qty: -1, rate: 100 }, { qty: 0, rate: 100 }, { qty: null, rate: 100 }, { qty: '', rate: 100 },
        { qty: 1, rate: -5 }, { qty: 1, rate: null }, { qty: 1, rate: '' }];
      for (const bad of bads) {
        const fetchImpl = billFetch([LINE]);
        await expect(adapterFor(billClient(), fetchImpl, false, [{ item_code: 'SPIKE-ITEM-1', ...bad }])).rejects.toThrow(refusalOf(bad));
        expect(writes(fetchImpl)).toHaveLength(0);
      }
    });

    // A line that is not on the order is sent to ERPNext too: it passes the same number check as an order line (PMO's own
    // case lines hold quantity >= 0 and rate >= 0, procurement_items_quantity_nonneg / _rate_nonneg, so a negative line is not a PMO bill).
    it('refuses a line that is not on the order whose qty is not above zero or whose rate is below zero, null or empty, before any ERP write', async () => {
      const bads = [{ qty: -1, rate: 50 }, { qty: 0, rate: 50 }, { qty: null, rate: 50 }, { qty: '', rate: 50 }, { qty: '  ', rate: 50 },
        { qty: 1, rate: -5 }, { qty: 1, rate: null }, { qty: 1, rate: '' }, { qty: 1, rate: ' ' }, { qty: 1 }, { qty: 'x', rate: 50 }];
      for (const bad of bads) {
        const fetchImpl = billFetch([LINE]);
        const items = [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 100 }, { item_code: 'FREIGHT', ...bad }];
        await expect(adapterFor(billClient(), fetchImpl, false, items)).rejects.toThrow(refusalOf(bad));
        expect(writes(fetchImpl)).toHaveLength(0);
      }
    });

    it('a line that is not on the order with a good quantity and a zero or positive rate is sent', async () => {
      const fetchImpl = billFetch([LINE]);
      const { adapter, command } = await adapterFor(billClient(), fetchImpl, false,
        [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 100 }, { item_code: 'FREIGHT', qty: 1, rate: 0 }, { item_code: 'FREIGHT', qty: '2', rate: '50' }]);
      await adapter.commit(command);
      expect(writes(fetchImpl).length).toBeGreaterThan(0);
    });

    // A purchase with no ERP order sends its bill's lines to ERPNext too: the same number check runs, with no order read.
    it('refuses every bill line of a purchase with no ERP order whose qty is not above zero or whose rate is below zero, null or empty, before any ERP write', async () => {
      const bads = [{ qty: -1, rate: 50 }, { qty: 0, rate: 50 }, { qty: null, rate: 50 }, { qty: '', rate: 50 }, { qty: '  ', rate: 50 },
        { qty: 1, rate: -5 }, { qty: 1, rate: null }, { qty: 1, rate: '' }, { qty: 1, rate: ' ' }, { qty: 1 }, { qty: 'x', rate: 50 }];
      for (const bad of bads) {
        for (const items of [[{ item_code: 'FREIGHT', ...bad }], [{ item_code: 'FREIGHT', qty: 1, rate: 10 }, { item_code: 'SPIKE-ITEM-1', ...bad }]]) {
          const fetchImpl = billFetch([LINE]);
          await expect(adapterFor(billClient({ noOrder: true }), fetchImpl, false, items)).rejects.toThrow(refusalOf(bad));
          expect(writes(fetchImpl)).toHaveLength(0);
        }
      }
    });

    it('refuses a bad line of the case itself (no caller lines) on a purchase with no ERP order, before any ERP write', async () => {
      const fetchImpl = billFetch([LINE]);
      await expect(adapterFor(billClient({ noOrder: true, qty: 0 }), fetchImpl)).rejects.toThrow(/quantity and rate must be numbers/);
      expect(writes(fetchImpl)).toHaveLength(0);
    });

    it('a valid bill on a purchase with no ERP order goes out unchanged and reads no order', async () => {
      const fetchImpl = billFetch([LINE]);
      const { adapter, command } = await adapterFor(billClient({ noOrder: true }), fetchImpl, false,
        [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 100 }, { item_code: 'FREIGHT', qty: 1, rate: 0 }]);
      await adapter.commit(command);
      const post = writes(fetchImpl).find(([, init]) => (init as RequestInit).method === 'POST')!;
      const sent = JSON.parse((post[1] as RequestInit).body as string).items as Array<Record<string, unknown>>;
      expect(sent).toEqual([{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 100 }, { item_code: 'FREIGHT', qty: 1, rate: 0 }]);
      const urls = (fetchImpl as unknown as { mock: { calls: string[][] } }).mock.calls.map(([u]) => decodeURIComponent(u));
      expect(urls.filter((u) => u.includes('Purchase Order'))).toEqual([]);
    });

    // The order line is found by the rate alone when only one order line has it; quantity decides only among lines sharing the rate.
    it('a part quantity at a rate only one order line has is billed against that line', async () => {
      const items = await sentBillItems(billClient({ qty: 1, rate: 150 }), billFetch(TWO({}, { rate: 150, amount: 300 })));
      expect(items[0]).toMatchObject({ po_detail: 'po-line-2' });
      const first = await sentBillItems(billClient({ qty: 1, rate: 100 }), billFetch(TWO({}, { rate: 150, amount: 300 })));
      expect(first[0]).toMatchObject({ po_detail: 'po-line-1' });
    });

    it('a part quantity at a rate two order lines share is billed against the one with its quantity', async () => {
      const items = await sentBillItems(billClient({ qty: 5, rate: 100 }), billFetch([...TWO({}, { qty: 5, amount: 500 }), { ...LINE, name: 'po-line-3', rate: 150, amount: 300 }]));
      expect(items[0]).toMatchObject({ po_detail: 'po-line-2' });
    });

    it('a part quantity at a rate two order lines share, with both quantities the same, is refused before any ERP write', async () => {
      const fetchImpl = billFetch([...TWO({}, {}), { ...LINE, name: 'po-line-3', rate: 150, amount: 300 }]);
      await expect(adapterFor(billClient({ qty: 1, rate: 100 }), fetchImpl)).rejects.toThrow(/on more than one line/);
      expect(writes(fetchImpl)).toHaveLength(0);
    });

    it('allows a bill that exactly uses what is left', async () => {
      const items = await sentBillItems(billClient({ qty: 1, rate: 100 }), billFetch([{ ...LINE, amount: 400, billed_amt: 300 }]));
      expect(items[0]).toMatchObject({ po_detail: 'po-line-1' });
    });

    it('a replay is not refused by its own bill already counted on the order', async () => {
      const fetchImpl = billFetch([{ ...LINE, amount: 400, billed_amt: 400 }]);
      const { command } = await adapterFor(billClient(), fetchImpl, true);
      expect(((command.record as { items?: Array<{ po_item_child_name?: string }> }).items ?? [])[0].po_item_child_name).toBe('po-line-1');
    });

    it('a bill submit reads no order and links nothing', async () => {
      const fetchImpl = billFetch([LINE]);
      const command = { domain: 'procurement' as const, operation: 'transition' as const,
        record: { id: 'pmo-pi-1', procurementId: 'proc-1', erp_doc_kind: 'purchase-invoice', verb: 'submit' } };
      await resolveErpDispatchAdapter({ serviceClient: billClient(), orgId: 'org-1', command, fetchImpl, apiKey: 'k', apiSecret: 's',
        doctypeBodies: (await import('./doctypeBodies.ts')).DOCTYPE_BODIES });
      const urls = (fetchImpl as unknown as { mock: { calls: string[][] } }).mock.calls.map(([u]) => decodeURIComponent(u));
      expect(urls.filter((u) => u.includes('Purchase Order'))).toEqual([]);
    });

    it('ERPNext 16: refuses a bill when its order is dated after today, before any ERP write', async () => {
      const fetchImpl = billFetch([LINE], { transaction_date: '2999-01-01' });
      await expect(adapterFor(billClient({ version: 16 }), fetchImpl)).rejects.toThrow(/dated 2999-01-01.*cannot be billed before that date/);
      expect(writes(fetchImpl)).toHaveLength(0);
    });

    it('ERPNext 15: an order dated after today does not stop the bill (v15 has no such rule)', async () => {
      const items = await sentBillItems(billClient({ version: 15 }), billFetch([LINE], { transaction_date: '2999-01-01' }));
      expect(items[0]).toMatchObject({ po_detail: 'po-line-1' });
    });
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
