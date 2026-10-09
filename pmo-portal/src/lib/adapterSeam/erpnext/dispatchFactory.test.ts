/**
 * erpnext/dispatchFactory.ts (task 2.13): resolves the per-org erpnext adapter, mirroring the ClickUp
 * dispatch-factory pattern. Reads the ALREADY-ACTIVATED `external_org_bindings` row (the version
 * handshake runs at bind-create/refresh time, FR-ENA-012 — not per-dispatch); `activated_at === null`
 * is refused `config-rejected` (a version mismatch, or never activated) BEFORE any command reaches
 * the adapter.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../appError.ts';
import { buildsSalesInvoiceBody, resolveErpDispatchAdapter, withPaymentTypeDiscriminator, type DispatchServiceClient } from './dispatchFactory.ts';
import { ERPNEXT_TIER } from './adapter.ts';
import type { PmoRecord } from '../contract.ts';

function serviceClientReturning(row: unknown): DispatchServiceClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: row, error: null }),
          }),
        }),
      }),
    }),
  } as unknown as DispatchServiceClient;
}

function itemCatalogResponse(url: string): Response | null {
  // #856: a VAT-on sales invoice reads the company's default Sales Taxes and Charges template before the create.
  const path = decodeURIComponent(new URL(url).pathname);
  // #866: an ordinary invoice create compares its currency with the customer's (else the company's) ERPNext billing currency.
  if (path.startsWith('/api/resource/Customer/') || path.startsWith('/api/resource/Company/')) return Response.json({ data: { default_currency: 'USD' } });
  if (path === '/api/resource/Sales Taxes and Charges Template') return Response.json({ data: [{ name: 'Smoke Tax' }] });
  if (path === '/api/resource/Sales Taxes and Charges Template/Smoke Tax') {
    return Response.json({ data: { name: 'Smoke Tax', taxes: [{ charge_type: 'On Net Total', account_head: 'VAT - PSC', rate: 11 }] } });
  }
  return new URL(url).pathname === '/api/resource/Item'
    ? Response.json({ data: ['X', 'ITEM-001'].map((name) => ({ name, item_name: name, disabled: 0, is_sales_item: 1, is_purchase_item: 1 })) })
    : null;
}

const ACTIVATED_ROW = {
  site_url: 'https://erp.example.com',
  version_major: 15,
  activated_at: '2026-07-11T00:00:00.000Z',
  config: { company: 'PMO Smoke Co', default_payable_account: 'Creditors - PSC' },
};

describe('erpnext/dispatchFactory', () => {
  it('resolves a tier="erpnext" adapter from an ACTIVATED binding row', async () => {
    const adapter = await resolveErpDispatchAdapter({
      serviceClient: serviceClientReturning(ACTIVATED_ROW),
      orgId: 'org-1',
      command: { domain: 'procurement', operation: 'create', record: { id: 'pmo-1', erp_doc_kind: 'purchase-order' } },
      fetchImpl: vi.fn() as unknown as typeof fetch,
      apiKey: 'k',
      apiSecret: 's',
    });
    expect(adapter.tier).toBe(ERPNEXT_TIER);
  });

  it('throws BINDING_NOT_ACTIVATED/config-rejected when activated_at is null (a version mismatch or never-activated binding)', async () => {
    const row = { ...ACTIVATED_ROW, activated_at: null };
    await expect(
      resolveErpDispatchAdapter({
        serviceClient: serviceClientReturning(row),
        orgId: 'org-1',
        command: { domain: 'procurement', operation: 'create', record: { id: 'pmo-1', erp_doc_kind: 'purchase-order' } },
        fetchImpl: vi.fn() as unknown as typeof fetch,
        apiKey: 'k',
        apiSecret: 's',
      }),
    ).rejects.toMatchObject({ code: 'config-rejected' });
  });

  it('throws when no binding row exists for the org', async () => {
    await expect(
      resolveErpDispatchAdapter({
        serviceClient: serviceClientReturning(null),
        orgId: 'org-1',
        command: { domain: 'procurement', operation: 'create', record: { id: 'pmo-1', erp_doc_kind: 'purchase-order' } },
        fetchImpl: vi.fn() as unknown as typeof fetch,
        apiKey: 'k',
        apiSecret: 's',
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('never leaks a secret into the adapter deps beyond the passed-in apiKey/apiSecret (never reads secret_ref itself)', async () => {
    const row = { ...ACTIVATED_ROW, secret_ref: 'vault/AS/erpnext-org-1' };
    const adapter = await resolveErpDispatchAdapter({
      serviceClient: serviceClientReturning(row),
      orgId: 'org-1',
      command: { domain: 'companies', operation: 'create', record: { id: 'pmo-1', erp_doc_kind: 'supplier' } },
      fetchImpl: vi.fn() as unknown as typeof fetch,
      apiKey: 'k',
      apiSecret: 's',
    });
    // resolving succeeds using ONLY the passed-in creds — no attempt to read/interpret secret_ref here.
    expect(adapter.tier).toBe(ERPNEXT_TIER);
  });

  it('threads afterSubmitHook into the adapter (FR-ENA-003 after-submit-before-mirror seam, task 2.14)', async () => {
    const afterSubmitHook = vi.fn(async () => {});
    let putCalled = false;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const catalog = itemCatalogResponse(_url);
      if (catalog) return catalog;
      if (init?.method === 'POST') return new Response(JSON.stringify({ name: 'PUR-ORD-2026-00001' }), { status: 200 });
      if (init?.method === 'PUT') {
        putCalled = true;
        return new Response(JSON.stringify({ name: 'PUR-ORD-2026-00001', docstatus: 1 }), { status: 200 });
      }
      return new Response(JSON.stringify({ name: 'PUR-ORD-2026-00001', docstatus: 1 }), { status: 200 });
    }) as unknown as typeof fetch;

    const adapter = await resolveErpDispatchAdapter({
      serviceClient: serviceClientReturning(ACTIVATED_ROW),
      orgId: 'org-1',
      command: { domain: 'procurement', operation: 'create', record: { id: 'pmo-1', erp_doc_kind: 'purchase-order', items: [{ item_code: 'X', qty: 1 }] } },
      fetchImpl,
      apiKey: 'k',
      apiSecret: 's',
      afterSubmitHook,
      doctypeBodies: { 'purchase-order': { toBody: (rec) => ({ items: rec.items }), fromDoc: () => ({ id: 'placeholder' }) } },
    });
    await adapter.commit({ domain: 'procurement', operation: 'create', record: { id: 'pmo-1', erp_doc_kind: 'purchase-order', items: [{ item_code: 'X', qty: 1 }] } });
    expect(putCalled).toBe(true);
    expect(afterSubmitHook).toHaveBeenCalledTimes(1);
  });

  it('task 4.6/4.7 — resolves record.vendorId through the companies external_refs mapping into ctx.refs.supplier (RFQ/SQ need a real ERP supplier)', async () => {
    // A multi-table-aware fake: external_org_bindings -> ACTIVATED_ROW; external_refs -> the Supplier mapping.
    const serviceClient: DispatchServiceClient = {
      from: (table: string) => ({
        select: () => {
          let filters: Record<string, string> = {};
          const chain = {
            eq: (col: string, val: string) => {
              filters = { ...filters, [col]: val };
              return chain;
            },
            maybeSingle: async () => {
              if (table === 'external_org_bindings') return { data: ACTIVATED_ROW, error: null };
              if (table === 'external_refs' && filters.domain === 'companies' && filters.pmo_record_id === 'company-1') {
                return { data: { external_record_id: 'Supplier:Spike Supplier' }, error: null };
              }
              // B10: the cross-org link pre-flight resolves `vendorId` against `companies.org_id`
              // before any ref resolution — the vendor belongs to the caller's org here.
              if (table === 'companies' && filters.id === 'company-1') return { data: { org_id: 'org-1' }, error: null };
              return { data: null, error: null };
            },
          };
          return chain;
        },
      }),
    } as unknown as DispatchServiceClient;

    let capturedToBodyCtx: unknown;
    const adapter = await resolveErpDispatchAdapter({
      serviceClient,
      orgId: 'org-1',
      command: { domain: 'procurement', operation: 'create', record: { id: 'pmo-1', erp_doc_kind: 'quotation', vendorId: 'company-1', items: [{ item_code: 'X', qty: 1, rate: 1 }] } },
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') return new Response(JSON.stringify({ name: 'PUR-SQTN-2026-00001' }), { status: 200 });
        if (init?.method === 'PUT') return new Response(JSON.stringify({ name: 'PUR-SQTN-2026-00001', docstatus: 1 }), { status: 200 });
        return new Response(JSON.stringify({ name: 'PUR-SQTN-2026-00001', docstatus: 1 }), { status: 200 });
      }) as unknown as typeof fetch,
      apiKey: 'k',
      apiSecret: 's',
      doctypeBodies: {
        quotation: {
          toBody: (rec, ctx) => {
            capturedToBodyCtx = ctx;
            return { supplier: ctx.refs.supplier, items: rec.items };
          },
          fromDoc: () => ({ id: 'placeholder' }),
        },
      },
    });
    await adapter.commit({ domain: 'procurement', operation: 'create', record: { id: 'pmo-1', erp_doc_kind: 'quotation', vendorId: 'company-1', items: [{ item_code: 'X', qty: 1, rate: 1 }] } });
    expect((capturedToBodyCtx as { refs: { supplier: string | null } }).refs.supplier).toBe('Spike Supplier');
  });

  it('leaves ctx.refs.supplier null when the command carries no vendorId (e.g. a Material Request)', async () => {
    let capturedToBodyCtx: unknown;
    const adapter = await resolveErpDispatchAdapter({
      serviceClient: serviceClientReturning(ACTIVATED_ROW),
      orgId: 'org-1',
      command: { domain: 'procurement', operation: 'create', record: { id: 'pmo-1', erp_doc_kind: 'purchase-request', items: [{ item_code: 'X', qty: 1 }] } },
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ name: 'MAT-REQ-2026-00001' }), { status: 200 })) as unknown as typeof fetch,
      apiKey: 'k',
      apiSecret: 's',
      doctypeBodies: {
        'purchase-request': {
          toBody: (rec, ctx) => {
            capturedToBodyCtx = ctx;
            return { items: rec.items };
          },
          fromDoc: () => ({ id: 'placeholder' }),
        },
      },
    });
    await adapter.commit({ domain: 'procurement', operation: 'create', record: { id: 'pmo-1', erp_doc_kind: 'purchase-request', items: [{ item_code: 'X', qty: 1 }] } }).catch(() => {});
    expect((capturedToBodyCtx as { refs: { supplier: string | null } } | undefined)?.refs.supplier ?? null).toBeNull();
  });
});

// ============================================================================
// Task 2.3 — Revenue ref resolver (FR-SAR-100/101/121)
// ============================================================================

describe('resolveRevenueRefs — task 2.3 (FR-SAR-100/101/121)', () => {
  const ACTIVATED_ROW_REVENUE = {
    site_url: 'https://erp.example.com',
    version_major: 15,
    activated_at: '2026-07-11T00:00:00.000Z',
    config: {
      company: 'PMO Smoke Co',
      default_receivable_account: 'Debtors - PSC',
      default_income_account: 'Sales - PSC',
      default_cash_account: 'Cash - PSC',
      default_bank_account: 'Bank - PSC',
      project_map: { 'proj-1': 'PROJ-0001' },
    },
  };

  /** The link-table rows behind the org-scoped pre-flight (Luna B2): `<table>:<id>` -> the row's REAL
   *  org_id. org-1 is the caller's org in these tests; org-2 is a DIFFERENT tenant, so a cross-org id
   *  is distinguishable from a same-org one by the id ALONE — an org-blind fake (one canned org_id per
   *  table) could not tell them apart and so could not prove the guard. */
  const TWO_ORG_ROWS: Record<string, { org_id: string; currency?: string; default_currency?: string }> = {
    'companies:cust-1': { org_id: 'org-1' },
    'companies:cust-org2': { org_id: 'org-2' },
    'projects:proj-1': { org_id: 'org-1', currency: 'USD' },
    'projects:proj-org2': { org_id: 'org-2' },
    'organizations:org-2': { org_id: 'org-2', default_currency: 'USD' },
    'organizations:org-1': { org_id: 'org-1', default_currency: 'USD' },
    'sales_invoices:si-1': { org_id: 'org-1' },
    'sales_invoices:si-org2': { org_id: 'org-2' },
  };

  function multiTableServiceClient(tables: Record<string, unknown>): DispatchServiceClient {
    return {
      from: (table: string) => ({
        select: () => {
          let filters: Record<string, string> = {};
          const chain = {
            eq: (col: string, val: string) => {
              filters = { ...filters, [col]: val };
              return chain;
            },
            order: () => chain,
            limit: () => chain,
            maybeSingle: async () => {
              if (table === 'external_org_bindings') {
                return { data: tables['external_org_bindings'] ?? null, error: null };
              }
              if (table === 'external_refs') {
                const key = `external_refs:${filters.domain}:${filters.pmo_record_id}`;
                return { data: tables[key] ?? null, error: null };
              }
              // The link tables (companies/projects/sales_invoices) — a REAL per-id row carrying its
              // own org_id, so the pre-flight resolves genuine tenancy rather than a canned answer.
              return { data: TWO_ORG_ROWS[`${table}:${filters.id}`] ?? null, error: null };
            },
          };
          return chain;
        },
      }),
    } as unknown as DispatchServiceClient;
  }

  it('sales-invoice: resolves ctx.refs.customer from record.customerId via companies external_refs (Customer:<name> -> bare name)', async () => {
    let capturedToBodyCtx: unknown;
    const serviceClient = multiTableServiceClient({
      external_org_bindings: ACTIVATED_ROW_REVENUE,
      'external_refs:companies:cust-1': { external_record_id: 'Customer:Spike Customer' },
    });

    const adapter = await resolveErpDispatchAdapter({
      serviceClient,
      orgId: 'org-1',
      command: {
        domain: 'revenue',
        operation: 'create',
        record: { id: 'pmo-1', erp_doc_kind: 'sales-invoice', customerId: 'cust-1', projectId: 'proj-1', items: [{ item_code: 'ITEM-001', qty: 1, rate: 100 }] },
      },
      fetchImpl: vi.fn(async (url: string) => itemCatalogResponse(url) ?? new Response(JSON.stringify({ name: 'ACC-SINV-2026-00001' }), { status: 200 })) as unknown as typeof fetch,
      apiKey: 'k',
      apiSecret: 's',
      doctypeBodies: {
        'sales-invoice': {
          toBody: (rec, ctx) => {
            capturedToBodyCtx = ctx;
            return { customer: ctx.refs.customer, items: rec.items };
          },
          fromDoc: () => ({ id: 'placeholder' }),
        },
      },
    });
    await adapter.commit({
      domain: 'revenue',
      operation: 'create',
      record: { id: 'pmo-1', erp_doc_kind: 'sales-invoice', customerId: 'cust-1', projectId: 'proj-1', items: [{ item_code: 'ITEM-001', qty: 1, rate: 100 }] },
    }).catch(() => {});
    expect((capturedToBodyCtx as { refs: { customer: string | null; project: string | null } } | undefined)?.refs.customer).toBe('Spike Customer');
  });

  it('sales-invoice: resolves ctx.refs.project from record.projectId via binding.config.project_map (ERP project name)', async () => {
    let capturedToBodyCtx: unknown;
    const serviceClient = multiTableServiceClient({
      external_org_bindings: ACTIVATED_ROW_REVENUE,
      'external_refs:companies:cust-1': { external_record_id: 'Customer:Spike Customer' },
    });

    const adapter = await resolveErpDispatchAdapter({
      serviceClient,
      orgId: 'org-1',
      command: {
        domain: 'revenue',
        operation: 'create',
        record: { id: 'pmo-1', erp_doc_kind: 'sales-invoice', customerId: 'cust-1', projectId: 'proj-1', items: [{ item_code: 'ITEM-001', qty: 1, rate: 100 }] },
      },
      fetchImpl: vi.fn(async (url: string) => itemCatalogResponse(url) ?? new Response(JSON.stringify({ name: 'ACC-SINV-2026-00001' }), { status: 200 })) as unknown as typeof fetch,
      apiKey: 'k',
      apiSecret: 's',
      doctypeBodies: {
        'sales-invoice': {
          toBody: (rec, ctx) => {
            capturedToBodyCtx = ctx;
            return { customer: ctx.refs.customer, items: rec.items };
          },
          fromDoc: () => ({ id: 'placeholder' }),
        },
      },
    });
    await adapter.commit({
      domain: 'revenue',
      operation: 'create',
      record: { id: 'pmo-1', erp_doc_kind: 'sales-invoice', customerId: 'cust-1', projectId: 'proj-1', items: [{ item_code: 'ITEM-001', qty: 1, rate: 100 }] },
    }).catch(() => {});
    expect((capturedToBodyCtx as { refs: { project: string | null } } | undefined)?.refs.project).toBe('PROJ-0001');
  });

  it('sales-invoice: ctx.refs.project is null when record.projectId is null (gate OFF / inbound-adopted path)', async () => {
    let capturedToBodyCtx: unknown;
    const serviceClient = multiTableServiceClient({
      external_org_bindings: ACTIVATED_ROW_REVENUE,
      'external_refs:companies:cust-1': { external_record_id: 'Customer:Spike Customer' },
    });

    const adapter = await resolveErpDispatchAdapter({
      serviceClient,
      orgId: 'org-1',
      command: {
        domain: 'revenue',
        operation: 'create',
        record: { id: 'pmo-1', erp_doc_kind: 'sales-invoice', customerId: 'cust-1', projectId: null, items: [{ item_code: 'ITEM-001', qty: 1, rate: 100 }] },
      },
      fetchImpl: vi.fn(async (url: string) => itemCatalogResponse(url) ?? new Response(JSON.stringify({ name: 'ACC-SINV-2026-00001' }), { status: 200 })) as unknown as typeof fetch,
      apiKey: 'k',
      apiSecret: 's',
      doctypeBodies: {
        'sales-invoice': {
          toBody: (rec, ctx) => {
            capturedToBodyCtx = ctx;
            return { customer: ctx.refs.customer, items: rec.items };
          },
          fromDoc: () => ({ id: 'placeholder' }),
        },
      },
    });
    await adapter.commit({
      domain: 'revenue',
      operation: 'create',
      record: { id: 'pmo-1', erp_doc_kind: 'sales-invoice', customerId: 'cust-1', projectId: null, items: [{ item_code: 'ITEM-001', qty: 1, rate: 100 }] },
    }).catch(() => {});
    expect((capturedToBodyCtx as { refs: { project: string | null } } | undefined)?.refs.project).toBeNull();
  });

  it('incoming-payment: resolves ctx.refs.customer + references[] from record.salesInvoiceId via revenue external_refs', async () => {
    let capturedToBodyCtx: unknown;
    const serviceClient = multiTableServiceClient({
      external_org_bindings: ACTIVATED_ROW_REVENUE,
      'external_refs:companies:cust-1': { external_record_id: 'Customer:Spike Customer' },
      'external_refs:revenue:si-1': { external_record_id: 'ACC-SINV-2026-00001' },
    });

    const adapter = await resolveErpDispatchAdapter({
      serviceClient,
      orgId: 'org-1',
      command: {
        domain: 'revenue',
        operation: 'create',
        record: { id: 'pmo-1', erp_doc_kind: 'incoming-payment', customerId: 'cust-1', salesInvoiceId: 'si-1', paidAmount: 100, receivedAmount: 100, date: '2026-07-14' },
      },
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ name: 'ACC-PE-REC-2026-00001' }), { status: 200 })) as unknown as typeof fetch,
      apiKey: 'k',
      apiSecret: 's',
      doctypeBodies: {
        'incoming-payment': {
          toBody: (rec, ctx) => {
            capturedToBodyCtx = ctx;
            return { party: ctx.refs.customer, references: rec.references };
          },
          fromDoc: () => ({ id: 'placeholder' }),
        },
      },
    });
    await adapter.commit({
      domain: 'revenue',
      operation: 'create',
      record: { id: 'pmo-1', erp_doc_kind: 'incoming-payment', customerId: 'cust-1', salesInvoiceId: 'si-1', paidAmount: 100, receivedAmount: 100, date: '2026-07-14' },
    }).catch(() => {});
    expect((capturedToBodyCtx as { refs: { customer: string | null } } | undefined)?.refs.customer).toBe('Spike Customer');
    // The body builder reads rec.references (set by the repo from salesInvoiceId) - we verify the ref resolution path
  });

  // Luna BLOCK 5 (MONEY-CRITICAL): for an incoming-payment, resolveRevenueRefs must populate
  // record.references with the RESOLVED SI ERP name (+ allocated_amount) so peReceiveToBody (reads
  // rec.references) AND the recovery composite-probe payload (si_names) cite it — else the body posts
  // empty references and the recovery probe can't match (wrongly HELD).
  it('Luna BLOCK 5 — incoming-payment: resolveRevenueRefs populates record.references with the resolved SI ERP name + allocated_amount', async () => {
    let capturedBody: unknown;
    const command = {
      domain: 'revenue',
      operation: 'create',
      record: { id: 'pmo-1', erp_doc_kind: 'incoming-payment', customerId: 'cust-1', salesInvoiceId: 'si-1', paid_amount: 100, received_amount: 100, date: '2026-07-14' },
    } as never;
    const serviceClient = multiTableServiceClient({
      external_org_bindings: ACTIVATED_ROW_REVENUE,
      'external_refs:companies:cust-1': { external_record_id: 'Customer:Spike Customer' },
      'external_refs:revenue:si-1': { external_record_id: 'ACC-SINV-2026-00001' },
    });
    const adapter = await resolveErpDispatchAdapter({
      serviceClient,
      orgId: 'org-1',
      command,
      fetchImpl: vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          capturedBody = body;
          return new Response(JSON.stringify({ name: 'ACC-PE-REC-2026-00001' }), { status: 200 });
        }
        return new Response(JSON.stringify({ name: 'ACC-PE-REC-2026-00001', docstatus: 0 }), { status: 200 });
      }) as unknown as typeof fetch,
      apiKey: 'k',
      apiSecret: 's',
      doctypeBodies: {
        'incoming-payment': {
          toBody: (rec: Record<string, unknown>) => ({ paid_amount: rec.paid_amount, references: rec.references ?? [] }),
          fromDoc: () => ({ id: 'placeholder' }),
        },
      } as never,
    });
    await adapter.commit(command).catch(() => {});

    // record.references is populated by resolveRevenueRefs with the resolved SI ERP name + amount.
    const refs = (command as unknown as { record: { references?: unknown[] } }).record.references;
    expect(refs).toEqual([
      { reference_doctype: 'Sales Invoice', reference_name: 'ACC-SINV-2026-00001', allocated_amount: 100 },
    ]);
    // And the POSTed ERP body carries non-null paid_amount + a references entry citing the SI.
    expect((capturedBody as { paid_amount?: unknown } | null)?.paid_amount).toBe(100);
    expect((capturedBody as { references?: Array<{ reference_name?: string }> } | null)?.references?.[0]?.reference_name).toBe('ACC-SINV-2026-00001');
  });

  // ============================================================================
  // Luna re-audit BLOCK 2 (orphan money) — cross-org link validation must happen BEFORE any ERP
  // write. `readModelWriters.assertLinkSameOrg` runs only in the MIRROR writers, i.e. AFTER
  // adapter.commit() + recordOutboxRef: a command pairing a valid customer with ANOTHER org's
  // salesInvoiceId therefore minted a REAL ERP money document and only then failed the mirror
  // insert — committed money with no PMO row. The pre-flight belongs here, in the dispatch path
  // ahead of the adapter being constructed at all, so a cross-org link is rejected with NO ERP
  // write and NO outbox commit (index.ts resolves the adapter before dispatchExternallyOwnedWrite).
  //
  // The `multiTableServiceClient` fixture above is a GENUINE two-org row table keyed by (table:id) —
  // each row carries its own real org_id, so a cross-org id is distinguishable from a same-org one by
  // the id alone. (An org-blind mock returning one canned org_id per table cannot prove this fix.)
  // ============================================================================

  const LINK_TABLES = {
    external_org_bindings: ACTIVATED_ROW_REVENUE,
    'external_refs:companies:cust-1': { external_record_id: 'Customer:Spike Customer' },
    'external_refs:companies:cust-org2': { external_record_id: 'Customer:Other Tenant Customer' },
    'external_refs:revenue:si-1': { external_record_id: 'ACC-SINV-2026-00001' },
    'external_refs:revenue:si-org2': { external_record_id: 'ACC-SINV-2026-09999' },
  };

  it('Luna B2 — sales-invoice: a customerId owned by ANOTHER org is rejected BEFORE any ERP write (no orphan money)', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await expect(
      resolveErpDispatchAdapter({
        serviceClient: multiTableServiceClient(LINK_TABLES),
        orgId: 'org-1',
        // cust-org2 genuinely belongs to org-2 in the fixture; cust-1 would pass.
        command: { domain: 'revenue', operation: 'create', record: { id: 'pmo-si-1', erp_doc_kind: 'sales-invoice', customerId: 'cust-org2', projectId: 'proj-1', items: [] } },
        fetchImpl,
        apiKey: 'k',
        apiSecret: 's',
      }),
    ).rejects.toMatchObject({ code: 'cross-org-link-rejected' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('Luna B2 — sales-invoice: a projectId owned by ANOTHER org is rejected BEFORE any ERP write', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await expect(
      resolveErpDispatchAdapter({
        serviceClient: multiTableServiceClient(LINK_TABLES),
        orgId: 'org-1',
        command: { domain: 'revenue', operation: 'create', record: { id: 'pmo-si-1', erp_doc_kind: 'sales-invoice', customerId: 'cust-1', projectId: 'proj-org2', items: [] } },
        fetchImpl,
        apiKey: 'k',
        apiSecret: 's',
      }),
    ).rejects.toMatchObject({ code: 'cross-org-link-rejected' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('Luna B2 — incoming-payment: a salesInvoiceId owned by ANOTHER org is rejected BEFORE any ERP write (the orphan-receipt case)', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await expect(
      resolveErpDispatchAdapter({
        serviceClient: multiTableServiceClient(LINK_TABLES),
        orgId: 'org-1',
        // A VALID own-org customer paired with ANOTHER org's SI — the exact audit scenario. Note the
        // cross-org SI even HAS an external_refs mapping, so the BLOCK-5 resolvability check passes:
        // only a real org_id check on the row can catch this.
        command: { domain: 'revenue', operation: 'create', record: { id: 'pmo-ip-1', erp_doc_kind: 'incoming-payment', customerId: 'cust-1', salesInvoiceId: 'si-org2', paid_amount: 100, date: '2026-07-16' } },
        fetchImpl,
        apiKey: 'k',
        apiSecret: 's',
      }),
    ).rejects.toMatchObject({ code: 'cross-org-link-rejected' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('Luna B2 — a link id that does not exist at all is rejected (fail closed, never a silent null link)', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await expect(
      resolveErpDispatchAdapter({
        serviceClient: multiTableServiceClient(LINK_TABLES),
        orgId: 'org-1',
        command: { domain: 'revenue', operation: 'create', record: { id: 'pmo-si-1', erp_doc_kind: 'sales-invoice', customerId: 'cust-does-not-exist', projectId: 'proj-1', items: [] } },
        fetchImpl,
        apiKey: 'k',
        apiSecret: 's',
      }),
    ).rejects.toMatchObject({ code: 'cross-org-link-rejected' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('Luna B2 — same-org links (customer + project + SI all in org-1) resolve normally: the adapter is built', async () => {
    const adapter = await resolveErpDispatchAdapter({
      serviceClient: multiTableServiceClient(LINK_TABLES),
      orgId: 'org-1',
      command: { domain: 'revenue', operation: 'create', record: { id: 'pmo-ip-1', erp_doc_kind: 'incoming-payment', customerId: 'cust-1', salesInvoiceId: 'si-1', paid_amount: 100, date: '2026-07-16' } },
      fetchImpl: vi.fn() as unknown as typeof fetch,
      apiKey: 'k',
      apiSecret: 's',
    });
    expect(adapter.tier).toBe(ERPNEXT_TIER);
  });

  it('Luna B2 — the SAME cross-org customerId is accepted for the org that DOES own it (the guard checks the row, not a canned answer)', async () => {
    const adapter = await resolveErpDispatchAdapter({
      serviceClient: multiTableServiceClient({ ...LINK_TABLES, 'external_refs:companies:cust-org2': { external_record_id: 'Customer:Other Tenant Customer' } }),
      // caller is org-2 this time — cust-org2 is its OWN customer, so the identical id must pass.
      orgId: 'org-2',
      command: { domain: 'revenue', operation: 'create', record: { id: 'pmo-si-2', erp_doc_kind: 'sales-invoice', customerId: 'cust-org2', items: [] } },
      fetchImpl: vi.fn(async (url: string) => itemCatalogResponse(url) ?? new Response('{}', { status: 200 })) as unknown as typeof fetch, // #856: an invoice create looks up the default tax template
      apiKey: 'k',
      apiSecret: 's',
    });
    expect(adapter.tier).toBe(ERPNEXT_TIER);
  });

  // ============================================================================
  // Luna re-audit BLOCK 4 — the require_project_on_si gate must require a RESOLVED ERP project, not
  // merely a non-null PMO projectId. index.ts checked only `record.projectId !== null`; a PMO project
  // with no `project_map` entry yields `ctx.refs.project === null` and `salesInvoice.toBody` then omits
  // the ERP `project` field entirely — so PMO reports project-attributed revenue while the ERP GL
  // carries no project dimension at all. With the gate ON, an unmapped project must fail closed.
  // ============================================================================

  /** The gate lives in `external_org_bindings.config.process_gates`; `project_map` maps PMO project id
   *  -> ERP project name. Here the gate is ON but `proj-unmapped` has no map entry. */
  const GATED_ROW = (gates: Record<string, boolean>, projectMap: Record<string, string> = { 'proj-1': 'PROJ-0001' }) => ({
    ...ACTIVATED_ROW_REVENUE,
    config: { ...ACTIVATED_ROW_REVENUE.config, project_map: projectMap, process_gates: gates },
  });

  it('Luna B4 — require_project_on_si ON + a projectId with NO project_map entry: fails closed BEFORE any ERP write (never silently unattributed revenue)', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await expect(
      resolveErpDispatchAdapter({
        serviceClient: multiTableServiceClient({ ...LINK_TABLES, external_org_bindings: GATED_ROW({ require_project_on_si: true }, {}) }),
        orgId: 'org-1',
        // proj-1 is a REAL own-org project (passes the B2 tenancy pre-flight) but this binding's
        // project_map is empty, so it maps to no ERP project — exactly the case the old gate waved
        // through (non-null projectId => "gate satisfied", ERP body silently omits `project`).
        command: { domain: 'revenue', operation: 'create', record: { id: 'pmo-si-1', erp_doc_kind: 'sales-invoice', customerId: 'cust-1', projectId: 'proj-1', items: [] } },
        fetchImpl,
        apiKey: 'k',
        apiSecret: 's',
      }),
    ).rejects.toMatchObject({ code: 'commit-rejected' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('Luna B4 — require_project_on_si ON + a MAPPED project: resolves normally (the gate blocks only unresolved projects)', async () => {
    const adapter = await resolveErpDispatchAdapter({
      serviceClient: multiTableServiceClient({ ...LINK_TABLES, external_org_bindings: GATED_ROW({ require_project_on_si: true }, { 'proj-1': 'PROJ-0001' }) }),
      orgId: 'org-1',
      command: { domain: 'revenue', operation: 'create', record: { id: 'pmo-si-1', erp_doc_kind: 'sales-invoice', customerId: 'cust-1', projectId: 'proj-1', items: [] } },
      fetchImpl: vi.fn(async (url: string) => itemCatalogResponse(url) ?? new Response('{}', { status: 200 })) as unknown as typeof fetch, // #856: an invoice create looks up the default tax template
      apiKey: 'k',
      apiSecret: 's',
    });
    expect(adapter.tier).toBe(ERPNEXT_TIER);
  });

  it('Luna B4 — require_project_on_si OFF: an unmapped project is allowed through (the gate is the only thing that makes it fatal)', async () => {
    const adapter = await resolveErpDispatchAdapter({
      serviceClient: multiTableServiceClient({ ...LINK_TABLES, external_org_bindings: GATED_ROW({ require_project_on_si: false }, {}) }),
      orgId: 'org-1',
      command: { domain: 'revenue', operation: 'create', record: { id: 'pmo-si-1', erp_doc_kind: 'sales-invoice', customerId: 'cust-1', projectId: 'proj-1', items: [] } },
      fetchImpl: vi.fn(async (url: string) => itemCatalogResponse(url) ?? new Response('{}', { status: 200 })) as unknown as typeof fetch, // #856: an invoice create looks up the default tax template
      apiKey: 'k',
      apiSecret: 's',
    });
    expect(adapter.tier).toBe(ERPNEXT_TIER);
  });

  it('Luna B4 — the gate applies to an SI CREATE only: a submit transition (which carries no projectId) is never blocked by it', async () => {
    const adapter = await resolveErpDispatchAdapter({
      serviceClient: multiTableServiceClient({ ...LINK_TABLES, external_org_bindings: GATED_ROW({ require_project_on_si: true }, {}) }),
      orgId: 'org-1',
      command: { domain: 'revenue', operation: 'transition', record: { id: 'pmo-si-1', erp_doc_kind: 'sales-invoice', externalRecordId: 'ACC-SINV-2026-00001', verb: 'submit' } },
      fetchImpl: vi.fn() as unknown as typeof fetch,
      apiKey: 'k',
      apiSecret: 's',
    });
    expect(adapter.tier).toBe(ERPNEXT_TIER);
  });

  it('non-revenue kinds (procurement) do NOT pay for revenue ref resolution (byte-for-byte)', async () => {
    let capturedToBodyCtx: unknown;
    const serviceClient = multiTableServiceClient({
      external_org_bindings: ACTIVATED_ROW_REVENUE,
      'external_refs:companies:cust-1': { external_record_id: 'Customer:Spike Customer' },
    });

    const adapter = await resolveErpDispatchAdapter({
      serviceClient,
      orgId: 'org-1',
      command: {
        domain: 'procurement',
        operation: 'create',
        record: { id: 'pmo-1', erp_doc_kind: 'purchase-order', vendorId: 'cust-1', items: [{ item_code: 'X', qty: 1 }] },
      },
      fetchImpl: vi.fn(async (url: string) => itemCatalogResponse(url) ?? new Response(JSON.stringify({ name: 'ACC-PO-2026-00001' }), { status: 200 })) as unknown as typeof fetch,
      apiKey: 'k',
      apiSecret: 's',
      doctypeBodies: {
        'purchase-order': {
          toBody: (rec, ctx) => {
            capturedToBodyCtx = ctx;
            return { supplier: ctx.refs.supplier, items: rec.items };
          },
          fromDoc: () => ({ id: 'placeholder' }),
        },
      },
    });
    await adapter.commit({
      domain: 'procurement',
      operation: 'create',
      record: { id: 'pmo-1', erp_doc_kind: 'purchase-order', vendorId: 'cust-1', items: [{ item_code: 'X', qty: 1 }] },
    }).catch(() => {});
    // procurement path uses supplier resolution, NOT customer/project resolution
    expect((capturedToBodyCtx as { refs: { customer?: string | null; project?: string | null } } | undefined)?.refs.customer).toBeUndefined();
    expect((capturedToBodyCtx as { refs: { customer?: string | null; project?: string | null } } | undefined)?.refs.project).toBeUndefined();
  });

  // ============================================================================
  // Luna BLOCK 5 (MONEY-CRITICAL) — PE-receive references FAIL CLOSED
  // ============================================================================

  it('Luna BLOCK 5 — incoming-payment: REJECTS when salesInvoiceId is present but UNRESOLVABLE (fail closed, no ERP write)', async () => {
    const command = {
      domain: 'revenue',
      operation: 'create',
      record: { id: 'pmo-1', erp_doc_kind: 'incoming-payment', customerId: 'cust-1', salesInvoiceId: 'si-missing', paid_amount: 100, received_amount: 100, date: '2026-07-14' },
    } as never;
    const serviceClient = multiTableServiceClient({
      external_org_bindings: ACTIVATED_ROW_REVENUE,
      'external_refs:companies:cust-1': { external_record_id: 'Customer:Spike Customer' },
      // si-missing has NO mapping in external_refs -> unresolvable
    });
    let fetchCalled = false;
    await expect(
      resolveErpDispatchAdapter({
        serviceClient,
        orgId: 'org-1',
        command,
        fetchImpl: vi.fn(async (_url: string, _init?: RequestInit) => {
          fetchCalled = true;
          return new Response(JSON.stringify({ name: 'ACC-PE-REC-2026-00001' }), { status: 200 });
        }) as unknown as typeof fetch,
        apiKey: 'k',
        apiSecret: 's',
        doctypeBodies: {
          'incoming-payment': {
            toBody: (rec: PmoRecord) => ({ paid_amount: rec.paid_amount, references: rec.references ?? [] }),
            fromDoc: () => ({ id: 'placeholder' }),
          },
        } as never,
      }),
    ).rejects.toMatchObject({ code: 'cross-org-link-rejected' });
    expect(fetchCalled).toBe(false); // no ERP write attempted
  });

  it('Luna BLOCK 5 — incoming-payment: DISCARDS caller-supplied references; builds references[] ONLY from resolved SI', async () => {
    let capturedBody: unknown;
    const command = {
      domain: 'revenue',
      operation: 'create',
      record: {
        id: 'pmo-1',
        erp_doc_kind: 'incoming-payment',
        customerId: 'cust-1',
        salesInvoiceId: 'si-1',
        paid_amount: 100,
        received_amount: 100,
        date: '2026-07-14',
        // Caller tries to inject arbitrary references (malicious or buggy)
        references: [
          { reference_doctype: 'Sales Invoice', reference_name: 'EVIL-SI-999', allocated_amount: 999999 },
        ],
      },
    } as never;
    const serviceClient = multiTableServiceClient({
      external_org_bindings: ACTIVATED_ROW_REVENUE,
      'external_refs:companies:cust-1': { external_record_id: 'Customer:Spike Customer' },
      'external_refs:revenue:si-1': { external_record_id: 'ACC-SINV-2026-00001' },
    });
    const adapter = await resolveErpDispatchAdapter({
      serviceClient,
      orgId: 'org-1',
      command,
      fetchImpl: vi.fn(async (url: string, init?: RequestInit) => {
        const isPost = init?.method === 'POST';
        if (isPost) {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          capturedBody = body;
          return new Response(JSON.stringify({ name: 'ACC-PE-REC-2026-00001' }), { status: 200 });
        }
        // GET to fetch created doc
        return new Response(JSON.stringify({ name: 'ACC-PE-REC-2026-00001', docstatus: 1, paid_amount: 100, references: [] }), { status: 200 });
      }) as unknown as typeof fetch,
      apiKey: 'k',
      apiSecret: 's',
      doctypeBodies: {
        'incoming-payment': {
          toBody: (rec: PmoRecord) => ({ paid_amount: rec.paid_amount, references: rec.references ?? [] }),
          fromDoc: () => ({ id: 'placeholder' }),
        },
      } as never,
    });
    await adapter.commit(command).catch(() => {});
    // Caller-supplied 'EVIL-SI-999' must be DISCARDED; only the resolved SI 'ACC-SINV-2026-00001' is sent
    expect((capturedBody as { references?: Array<{ reference_name?: string }> } | null)?.references?.[0]?.reference_name).toBe('ACC-SINV-2026-00001');
    expect((capturedBody as { references?: Array<{ reference_name?: string }> } | null)?.references?.length).toBe(1);
  });

  it('Luna BLOCK 5 — incoming-payment: ALLOWS unreferenced on-account receipt ONLY when salesInvoiceId is null/absent', async () => {
    let capturedBody: unknown;
    const command = {
      domain: 'revenue',
      operation: 'create',
      record: { id: 'pmo-1', erp_doc_kind: 'incoming-payment', customerId: 'cust-1', salesInvoiceId: null, paid_amount: 100, received_amount: 100, date: '2026-07-14' },
    } as never;
    const serviceClient = multiTableServiceClient({
      external_org_bindings: ACTIVATED_ROW_REVENUE,
      'external_refs:companies:cust-1': { external_record_id: 'Customer:Spike Customer' },
    });
    const adapter = await resolveErpDispatchAdapter({
      serviceClient,
      orgId: 'org-1',
      command,
      fetchImpl: vi.fn(async (url: string, init?: RequestInit) => {
        const isPost = init?.method === 'POST';
        if (isPost) {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          capturedBody = body;
          return new Response(JSON.stringify({ name: 'ACC-PE-REC-2026-00001' }), { status: 200 });
        }
        // GET to fetch created doc
        return new Response(JSON.stringify({ name: 'ACC-PE-REC-2026-00001', docstatus: 1, paid_amount: 100, references: [] }), { status: 200 });
      }) as unknown as typeof fetch,
      apiKey: 'k',
      apiSecret: 's',
      doctypeBodies: {
        'incoming-payment': {
          toBody: (rec: PmoRecord) => ({ paid_amount: rec.paid_amount, references: rec.references ?? [] }),
          fromDoc: () => ({ id: 'placeholder' }),
        },
      } as never,
    });
    await adapter.commit(command).catch(() => {});
    // No salesInvoiceId -> no references sent (empty array); this is a valid on-account receipt
    expect((capturedBody as { references?: unknown[] } | null)?.references).toEqual([]);
  });
});

// ============================================================================
// Luna re-audit BLOCK #12 — `require_project_on_si` was enforced on CREATE ONLY.
//
// `assertSiProjectGate` returned early for every non-create operation, and index.ts gated only
// `create`. But an `update` of a SUBMITTED SI routes to amend (adapter.ts routeEdit(1) ->
// commitAmend) and `transition{verb:'amend'}` does the same: both build a REPLACEMENT Sales Invoice
// from `bodies/salesInvoice.ts`, which OMITS the ERP `project` field when it is unresolved. So a
// caller could amend a submitted, project-attributed SI into a replacement carrying no project
// dimension on the GL, have a second approver submit it, and PMO would still report the old project
// attribution. Contradicts the signed spec (erpnext-adapter-p3a-sales-ar.spec.md:713-718).
// ============================================================================

describe('Luna B12 — require_project_on_si applies to every SI body-building operation', () => {
  const ACTIVATED_ROW_B12 = {
    site_url: 'https://erp.example.com',
    version_major: 15,
    activated_at: '2026-07-11T00:00:00.000Z',
    config: {
      company: 'PMO Smoke Co',
      default_receivable_account: 'Debtors - PSC',
      default_income_account: 'Sales - PSC',
      project_map: {} as Record<string, string>,
      process_gates: { require_project_on_si: true },
    },
  };

  function bindingClient(config: Record<string, unknown>): DispatchServiceClient {
    return {
      from: (table: string) => ({
        select: () => {
          let filters: Record<string, string> = {};
          const chain = {
            eq: (col: string, val: string) => {
              filters = { ...filters, [col]: val };
              return chain;
            },
            order: () => chain,
            limit: () => chain,
            maybeSingle: async () => {
              if (table === 'external_org_bindings') return { data: { ...ACTIVATED_ROW_B12, config }, error: null };
              if (table === 'external_refs' && filters.domain === 'companies') {
                return { data: { external_record_id: 'Customer:Spike Customer' }, error: null };
              }
              if (table === 'external_refs' && filters.domain === 'revenue') {
                return { data: { external_record_id: 'ACC-SINV-2026-00001' }, error: null };
              }
              // #766: these invoices are not progress claims — no claim row exists for the record id.
              if (table === 'progress_claims') return { data: null, error: null };
              // OD-BILL-1: an edit or amend is stated in its mirror row's currency.
              if (table === 'sales_invoices') return { data: { org_id: 'org-1', currency: 'USD' }, error: null };
              // Every link row belongs to org-1 (the caller's org) — the tenancy pre-flight is not
              // what these tests are about.
              return { data: { org_id: 'org-1' }, error: null };
            },
            then: (resolve: (v: { data: unknown; error: null }) => unknown) => resolve({ data: [], error: null }),
          };
          return chain;
        },
      }),
    } as unknown as DispatchServiceClient;
  }

  const GATE_ON_UNMAPPED = { ...ACTIVATED_ROW_B12.config, project_map: {}, process_gates: { require_project_on_si: true } };
  const GATE_ON_MAPPED = { ...ACTIVATED_ROW_B12.config, project_map: { 'proj-1': 'PROJ-0001' }, process_gates: { require_project_on_si: true } };
  const GATE_OFF = { ...ACTIVATED_ROW_B12.config, project_map: {}, process_gates: { require_project_on_si: false } };

  const siRecord = (extra: Record<string, unknown>) => ({
    id: 'pmo-si-1',
    erp_doc_kind: 'sales-invoice',
    customerId: 'cust-1',
    projectId: 'proj-1',
    items: [],
    ...extra,
  });

  it('B12 — an UPDATE of an SI whose project resolves to no ERP project fails closed BEFORE any ERP write', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await expect(
      resolveErpDispatchAdapter({
        serviceClient: bindingClient(GATE_ON_UNMAPPED),
        orgId: 'org-1',
        command: { domain: 'revenue', operation: 'update', record: siRecord({ externalRecordId: 'ACC-SINV-2026-00001' }) },
        fetchImpl,
        apiKey: 'k',
        apiSecret: 's',
      }),
    ).rejects.toMatchObject({ code: 'commit-rejected' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('B12 — an AMEND transition of an SI whose project resolves to no ERP project fails closed BEFORE any ERP write', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await expect(
      resolveErpDispatchAdapter({
        serviceClient: bindingClient(GATE_ON_UNMAPPED),
        orgId: 'org-1',
        command: {
          domain: 'revenue',
          operation: 'transition',
          record: siRecord({ verb: 'amend', externalRecordId: 'ACC-SINV-2026-00001' }),
        },
        fetchImpl,
        apiKey: 'k',
        apiSecret: 's',
      }),
    ).rejects.toMatchObject({ code: 'commit-rejected' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('B12 — an UPDATE whose project IS mapped resolves normally (the gate blocks only unresolved projects)', async () => {
    const adapter = await resolveErpDispatchAdapter({
      serviceClient: bindingClient(GATE_ON_MAPPED),
      orgId: 'org-1',
      command: { domain: 'revenue', operation: 'update', record: siRecord({ externalRecordId: 'ACC-SINV-2026-00001' }) },
      fetchImpl: vi.fn() as unknown as typeof fetch,
      apiKey: 'k',
      apiSecret: 's',
    });
    expect(adapter.tier).toBe(ERPNEXT_TIER);
  });

  it('B12 — a SUBMIT transition builds no body and is still never blocked by the gate', async () => {
    const adapter = await resolveErpDispatchAdapter({
      serviceClient: bindingClient(GATE_ON_UNMAPPED),
      orgId: 'org-1',
      command: {
        domain: 'revenue',
        operation: 'transition',
        record: { id: 'pmo-si-1', erp_doc_kind: 'sales-invoice', verb: 'submit', externalRecordId: 'ACC-SINV-2026-00001' },
      },
      fetchImpl: vi.fn() as unknown as typeof fetch,
      apiKey: 'k',
      apiSecret: 's',
    });
    expect(adapter.tier).toBe(ERPNEXT_TIER);
  });

  it('B12 — a CANCEL transition builds no body and is still never blocked by the gate', async () => {
    const adapter = await resolveErpDispatchAdapter({
      serviceClient: bindingClient(GATE_ON_UNMAPPED),
      orgId: 'org-1',
      command: {
        domain: 'revenue',
        operation: 'transition',
        record: { id: 'pmo-si-1', erp_doc_kind: 'sales-invoice', verb: 'cancel', externalRecordId: 'ACC-SINV-2026-00001' },
      },
      fetchImpl: vi.fn() as unknown as typeof fetch,
      apiKey: 'k',
      apiSecret: 's',
    });
    expect(adapter.tier).toBe(ERPNEXT_TIER);
  });

  it('B12 — gate OFF: an unmapped project on an amend is allowed through (the gate is the only thing that makes it fatal)', async () => {
    const adapter = await resolveErpDispatchAdapter({
      serviceClient: bindingClient(GATE_OFF),
      orgId: 'org-1',
      command: {
        domain: 'revenue',
        operation: 'transition',
        record: siRecord({ verb: 'amend', externalRecordId: 'ACC-SINV-2026-00001' }),
      },
      fetchImpl: vi.fn() as unknown as typeof fetch,
      apiKey: 'k',
      apiSecret: 's',
    });
    expect(adapter.tier).toBe(ERPNEXT_TIER);
  });
});

// The SHARED predicate index.ts uses for its own half of the same gate (the "is projectId present at
// all" check). Exported from dispatchFactory so the two enforcement points can never disagree about
// which operations build a Sales Invoice body.
describe('Luna B12 — buildsSalesInvoiceBody (the shared operation predicate)', () => {
  it('is true for create, update, and an amend transition — the three that call salesInvoice.toBody', () => {
    expect(buildsSalesInvoiceBody({ operation: 'create', record: {} })).toBe(true);
    expect(buildsSalesInvoiceBody({ operation: 'update', record: {} })).toBe(true);
    expect(buildsSalesInvoiceBody({ operation: 'transition', record: { verb: 'amend' } })).toBe(true);
  });

  it('is false for submit/cancel transitions and for delete — they act on an existing doc, building no body', () => {
    expect(buildsSalesInvoiceBody({ operation: 'transition', record: { verb: 'submit' } })).toBe(false);
    expect(buildsSalesInvoiceBody({ operation: 'transition', record: { verb: 'cancel' } })).toBe(false);
    expect(buildsSalesInvoiceBody({ operation: 'delete', record: {} })).toBe(false);
  });
});

// ============================================================================
// Luna re-audit BLOCK #1 (this call site's half) — the FALLBACK anchor probe dropped the
// `payment_type` discriminator.
//
// 'Pay' (procurement) and 'Receive' (revenue) Payment Entries are the SAME Frappe doctype, and their
// anchor field `reference_no` is ERP-side editable. `probeErpByPaymentComposite` correctly conjoins
// payment_type + party_type onto its anchor probe — but the adapter-dispatch fallback used when no
// composite payload has been persisted yet called the BARE `probeErpByAnchorKey`, so a Receive
// recovery could adopt a Pay entry that happened to share a reference_no (and vice-versa), mirroring
// an incoming payment onto an outgoing payment document.
// ============================================================================

describe('Luna B1 — withPaymentTypeDiscriminator (the fallback anchor-probe guard)', () => {
  const BASE = {
    client: { fetchImpl: vi.fn() as unknown as typeof fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.com' },
    doctype: 'Payment Entry',
    anchorField: 'reference_no',
    fromDoc: () => ({ id: 'x' }),
    pmoRecordId: 'pmo-1',
  };

  it("an incoming-payment probe filters payment_type='Receive' server-side AND re-validates the fetched doc", () => {
    const deps = withPaymentTypeDiscriminator(BASE, 'incoming-payment');
    expect(deps.anchorExtraFilters).toEqual([['payment_type', '=', 'Receive']]);
    expect(deps.validateAdoptedDoc?.({ payment_type: 'Receive' })).toBe(true);
    // The exploit: a Pay entry sharing the reference_no must never be adopted by a Receive recovery.
    expect(deps.validateAdoptedDoc?.({ payment_type: 'Pay' })).toBe(false);
  });

  it("a procurement payment probe filters payment_type='Pay' and refuses a Receive doc", () => {
    const deps = withPaymentTypeDiscriminator(BASE, 'payment');
    expect(deps.anchorExtraFilters).toEqual([['payment_type', '=', 'Pay']]);
    expect(deps.validateAdoptedDoc?.({ payment_type: 'Pay' })).toBe(true);
    expect(deps.validateAdoptedDoc?.({ payment_type: 'Receive' })).toBe(false);
  });

  it('a doc missing payment_type entirely is refused (fail closed, never adopted on absence)', () => {
    const deps = withPaymentTypeDiscriminator(BASE, 'incoming-payment');
    expect(deps.validateAdoptedDoc?.({})).toBe(false);
  });

  it('a non-Payment-Entry kind is returned byte-for-byte (PI/Purchase Receipt keep the bare anchor probe)', () => {
    const deps = withPaymentTypeDiscriminator(BASE, 'purchase-invoice');
    expect(deps).toBe(BASE);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// #910 task 2 — resolvePaymentRefs (FR-VPAY-002/003/004/006, AC-VPAY-004). The `payment` kind joins
// the refs pass: the case's vendor resolves via the SAME `resolveCaseSupplierName` read the PO/GR/PI
// path uses, and the bill's ERP Purchase Invoice name resolves from `external_refs` (procurement
// domain). references[] are built SERVER-side from the resolved bill — caller-supplied rows are
// discarded (the Luna BLOCK 5 precedent for incoming-payment). Every refusal below happens BEFORE
// any ERP write/outbox insert, with ZERO ERP reads (the gates are PMO-side DB reads only).
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('resolvePaymentRefs — #910 task 2 (FR-VPAY-002/003/004/006)', () => {
  const ACTIVATED_ROW_PROCUREMENT = {
    site_url: 'https://erp.example.com',
    version_major: 15,
    activated_at: '2026-07-11T00:00:00.000Z',
    config: {
      company: 'PMO Smoke Co',
      default_cash_account: 'Cash - PSC',
      default_payable_account: 'Creditors - PSC',
    },
  };

  /** The link/row table behind the org-scoped reads: `<table>:<id>` -> the row's REAL org_id, so a
   *  cross-org id is distinguishable from a same-org one by the id ALONE (the Luna B2 fixture rule).
   *  `procurement_invoices` carries its case anchor (`procurement_id`), the mirrored ERP outstanding
   *  the amount gate reads and the mirrored `currency` the §1 currency gate reads. `procurements`
   *  carries the vendor the supplier resolution reads; `organizations` carries the org's
   *  `default_currency` — the binding company currency the bill's currency must match (0187). */
  const PAYMENT_ROWS: Record<string, Record<string, unknown>> = {
    'organizations:org-1': { default_currency: 'IDR' },
    'procurements:proc-1': { org_id: 'org-1', vendor_id: 'vend-1' },
    'procurements:proc-other': { org_id: 'org-1', vendor_id: 'vend-1' },
    'procurements:proc-org2': { org_id: 'org-2', vendor_id: 'vend-2' },
    'procurement_invoices:inv-1': { org_id: 'org-1', procurement_id: 'proc-1', erp_outstanding_amount: 1090000, vi_number: 'ACC-PINV-2026-00910', currency: 'IDR' },
    'procurement_invoices:inv-other-case': { org_id: 'org-1', procurement_id: 'proc-other', erp_outstanding_amount: 1090000, vi_number: 'ACC-PINV-2026-00911', currency: 'IDR' },
    'procurement_invoices:inv-null-outstanding': { org_id: 'org-1', procurement_id: 'proc-1', erp_outstanding_amount: null, vi_number: 'ACC-PINV-2026-00912', currency: 'IDR' },
    'procurement_invoices:inv-unmapped': { org_id: 'org-1', procurement_id: 'proc-1', erp_outstanding_amount: 100, vi_number: 'ACC-PINV-2026-00913', currency: 'IDR' },
    'procurement_invoices:inv-org2': { org_id: 'org-2', procurement_id: 'proc-org2', erp_outstanding_amount: 500, vi_number: 'ACC-PINV-2026-09999', currency: 'USD' },
  };

  const PAYMENT_REFS: Record<string, unknown> = {
    'external_refs:companies:vend-1': { external_record_id: 'Supplier:Spike Supplier' },
    'external_refs:procurement:inv-1': { external_record_id: 'ACC-PINV-2026-00910' },
  };

  function paymentServiceClient(tables: Record<string, unknown>): DispatchServiceClient {
    return {
      from: (table: string) => ({
        select: () => {
          let filters: Record<string, string> = {};
          const chain = {
            eq: (col: string, val: string) => {
              filters = { ...filters, [col]: val };
              return chain;
            },
            order: () => chain,
            limit: () => chain,
            maybeSingle: async () => {
              if (table === 'external_org_bindings') return { data: tables['external_org_bindings'] ?? null, error: null };
              if (table === 'external_refs') {
                const key = `external_refs:${filters.domain}:${filters.pmo_record_id}`;
                return { data: tables[key] ?? null, error: null };
              }
              return { data: tables[`${table}:${filters.id}`] ?? null, error: null };
            },
          };
          return chain;
        },
      }),
    } as unknown as DispatchServiceClient;
  }

  function paymentCommand(overrides: Record<string, unknown> = {}): {
    domain: string;
    operation: string;
    record: PmoRecord;
    idempotencyKey: string;
  } {
    return {
      domain: 'procurement',
      operation: 'create',
      record: {
        id: 'pmo-pay-1',
        erp_doc_kind: 'payment',
        procurementId: 'proc-1',
        invoiceId: 'inv-1',
        paid_amount: 1090000,
        date: '2026-10-08',
        ...overrides,
      },
      idempotencyKey: crypto.randomUUID(),
    };
  }

  async function resolveAdapter(command: ReturnType<typeof paymentCommand>, tables: Record<string, unknown>, fetchImpl: typeof fetch, replay = false) {
    return resolveErpDispatchAdapter({
      serviceClient: paymentServiceClient(tables),
      orgId: 'org-1',
      command: command as never,
      fetchImpl,
      apiKey: 'k',
      apiSecret: 's',
      replay,
      doctypeBodies: {
        payment: {
          toBody: (rec: PmoRecord, ctx: { refs: Record<string, string | null> }) => ({ party: ctx.refs.supplier, paid_amount: rec.paid_amount, references: rec.references ?? [] }),
          fromDoc: () => ({ id: 'placeholder' }),
        },
      } as never,
    });
  }

  const HAPPY_TABLES = { external_org_bindings: ACTIVATED_ROW_PROCUREMENT, ...PAYMENT_ROWS, ...PAYMENT_REFS };

  it('happy path: refs.supplier = the case vendor (the SAME resolveCaseSupplierName read) + refs.pi = the bill\'s ERP name, with ZERO ERP reads during resolution', async () => {
    let capturedToBodyCtx: unknown;
    const command = paymentCommand();
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify({ name: 'ACC-PAY-2026-00910' }), { status: 200 });
      return new Response(JSON.stringify({ name: 'ACC-PAY-2026-00910', docstatus: 0 }), { status: 200 });
    }) as unknown as typeof fetch;
    const adapter = await resolveErpDispatchAdapter({
      serviceClient: paymentServiceClient(HAPPY_TABLES),
      orgId: 'org-1',
      command: command as never,
      fetchImpl,
      apiKey: 'k',
      apiSecret: 's',
      doctypeBodies: {
        payment: {
          toBody: (rec: PmoRecord, ctx: { refs: Record<string, string | null> }) => {
            capturedToBodyCtx = ctx;
            return { party: ctx.refs.supplier, paid_amount: rec.paid_amount, references: rec.references ?? [] };
          },
          fromDoc: () => ({ id: 'placeholder' }),
        },
      } as never,
    });
    // Resolution itself reads NOTHING from ERP (NFR-VPAY-001: at most three DB reads, zero ERP reads).
    expect(fetchImpl).not.toHaveBeenCalled();
    await adapter.commit(command as never).catch(() => {});
    const ctx = capturedToBodyCtx as { refs: { supplier?: string; pi?: string } } | undefined;
    expect(ctx?.refs.supplier).toBe('Spike Supplier'); // bare ERP name (the `Supplier:` prefix stripped)
    expect(ctx?.refs.pi).toBe('ACC-PINV-2026-00910');
  });

  it('DD-VPAY-2 — caller-supplied references are DISCARDED; the record carries the server-resolved bill allocation', async () => {
    const command = paymentCommand({
      references: [{ reference_doctype: 'Purchase Invoice', reference_name: 'ACC-PINV-OTHER-BILL', allocated_amount: 1 }],
    });
    const adapter = await resolveAdapter(command, HAPPY_TABLES, vi.fn() as unknown as typeof fetch);
    await adapter.commit(command as never).catch(() => {});
    expect((command.record as { references?: unknown[] }).references).toEqual([
      { reference_doctype: 'Purchase Invoice', reference_name: 'ACC-PINV-2026-00910', allocated_amount: 1090000 },
    ]);
  });

  it('FR-VPAY-004a — no invoiceId refuses commit-rejected before any ERP write', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await expect(
      resolveAdapter(paymentCommand({ invoiceId: null }), HAPPY_TABLES, fetchImpl),
    ).rejects.toMatchObject({ code: 'commit-rejected' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('FR-VPAY-004b — a bill with NO procurement external_refs mapping refuses (commit-rejected, zero ERP reads)', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await expect(
      resolveAdapter(paymentCommand({ invoiceId: 'inv-unmapped' }), HAPPY_TABLES, fetchImpl),
    ).rejects.toMatchObject({ code: 'commit-rejected' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('FR-VPAY-004c — a bill on ANOTHER case (procurement_id ≠ record.procurementId) refuses naming the bill', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await expect(resolveAdapter(paymentCommand({ invoiceId: 'inv-other-case' }), HAPPY_TABLES, fetchImpl))
      .rejects.toSatisfy((err: AppError) => err.code === 'commit-rejected' && /ACC-PINV-2026-00911/.test(err.message));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('replay with refreshed zero outstanding builds the adapter and reaches the recovery probe', async () => {
    const command = paymentCommand();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })) as unknown as typeof fetch;
    const tables = {
      ...HAPPY_TABLES,
      'procurement_invoices:inv-1': { ...PAYMENT_ROWS['procurement_invoices:inv-1'], erp_outstanding_amount: 0 },
    };
    const adapter = await resolveAdapter(command, tables, fetchImpl, true);
    await adapter.commit(command as never).catch(() => {});
    expect(fetchImpl).toHaveBeenCalled();
    expect((command.record as { references?: unknown[] }).references).toEqual([
      { reference_doctype: 'Purchase Invoice', reference_name: 'ACC-PINV-2026-00910', allocated_amount: 1090000 },
    ]);
  });

  it('FR-VPAY-006a — paid_amount above the bill\'s outstanding refuses naming the bill', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await expect(resolveAdapter(paymentCommand({ paid_amount: 1090001 }), HAPPY_TABLES, fetchImpl))
      .rejects.toSatisfy((err: AppError) => err.code === 'commit-rejected' && /ACC-PINV-2026-00910/.test(err.message));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('FR-VPAY-006b — paid_amount ≤ 0 refuses', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await expect(resolveAdapter(paymentCommand({ paid_amount: 0 }), HAPPY_TABLES, fetchImpl)).rejects.toMatchObject({ code: 'commit-rejected' });
    await expect(resolveAdapter(paymentCommand({ paid_amount: -1 }), HAPPY_TABLES, fetchImpl)).rejects.toMatchObject({ code: 'commit-rejected' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('FR-VPAY-006c — a bill whose erp_outstanding_amount is null refuses (never uncapped)', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await expect(resolveAdapter(paymentCommand({ invoiceId: 'inv-null-outstanding' }), HAPPY_TABLES, fetchImpl))
      .rejects.toSatisfy((err: AppError) => err.code === 'commit-rejected' && /ACC-PINV-2026-00912/.test(err.message));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('spec §1 / OBS-VPAY-003 — a bill in a FOREIGN currency refuses with the plain not-supported wording (zero ERP reads)', async () => {
    // paid_amount is company-currency money; erp_outstanding_amount is the BILL's currency. Cross-
    // currency the DD-VPAY-7 amount gate is unsound, so the bill must be in the org's currency.
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await expect(resolveAdapter(paymentCommand({ invoiceId: 'inv-fx' }), {
      ...HAPPY_TABLES,
      'procurement_invoices:inv-fx': { org_id: 'org-1', procurement_id: 'proc-1', erp_outstanding_amount: 1090000, vi_number: 'ACC-PINV-2026-00914', currency: 'USD' },
      'external_refs:procurement:inv-fx': { external_record_id: 'ACC-PINV-2026-00914' },
    }, fetchImpl)).rejects.toSatisfy((err: AppError) =>
      err.code === 'commit-rejected' &&
      err.message === 'This bill is in USD; paying a foreign-currency bill from PMO is not supported yet — pay it in ERPNext.');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('spec §1 / OBS-VPAY-003 — a bill whose mirrored currency is UNKNOWN (null / the XXX placeholder) refuses fail-closed', async () => {
    // An unmirrored currency cannot be PROVEN same-currency — the fail-closed posture, never "absent ⇒ allowed".
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    for (const currency of [null, 'XXX']) {
      await expect(resolveAdapter(paymentCommand({ invoiceId: 'inv-nofx' }), {
        ...HAPPY_TABLES,
        'procurement_invoices:inv-nofx': { org_id: 'org-1', procurement_id: 'proc-1', erp_outstanding_amount: 1090000, vi_number: 'ACC-PINV-2026-00915', currency },
        'external_refs:procurement:inv-nofx': { external_record_id: 'ACC-PINV-2026-00915' },
      }, fetchImpl)).rejects.toSatisfy((err: AppError) =>
        err.code === 'commit-rejected' && /ACC-PINV-2026-00915/.test(err.message));
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('spec §1 / OBS-VPAY-003 — an org whose default_currency is unreadable refuses (the comparison oracle is gone)', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await expect(resolveAdapter(paymentCommand(), { ...HAPPY_TABLES, 'organizations:org-1': null }, fetchImpl))
      .rejects.toMatchObject({ code: 'commit-rejected' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('FR-VPAY-002 — a bill owned by ANOTHER org is refused before any ERP write (the pre-flight keeps holding)', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await expect(
      resolveAdapter(paymentCommand({ invoiceId: 'inv-org2', procurementId: 'proc-org2' }), HAPPY_TABLES, fetchImpl),
    ).rejects.toMatchObject({ code: 'cross-org-link-rejected' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('non-payment kinds do NOT pay for payment ref resolution (byte-for-byte neighbours)', async () => {
    // The PO create on the same org resolves its own refs exactly as before — the payment gate never runs.
    const command = {
      domain: 'procurement',
      operation: 'create',
      record: { id: 'pmo-po-1', erp_doc_kind: 'purchase-order', procurementId: 'proc-1', items: [{ item_code: 'X', qty: 1, rate: 1, schedule_date: '2026-10-08' }] },
      idempotencyKey: crypto.randomUUID(),
    } as never;
    const adapter = await resolveErpDispatchAdapter({
      serviceClient: paymentServiceClient(HAPPY_TABLES),
      orgId: 'org-1',
      command,
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ name: 'PUR-ORD-2026-00001' }), { status: 200 })) as unknown as typeof fetch,
      apiKey: 'k',
      apiSecret: 's',
    });
    expect(adapter.tier).toBe(ERPNEXT_TIER);
  });
});
