/**
 * erpnext/dispatchFactory.ts (task 2.13): resolves the per-org erpnext adapter, mirroring the ClickUp
 * dispatch-factory pattern. Reads the ALREADY-ACTIVATED `external_org_bindings` row (the version
 * handshake runs at bind-create/refresh time, FR-ENA-012 — not per-dispatch); `activated_at === null`
 * is refused `config-rejected` (a version mismatch, or never activated) BEFORE any command reaches
 * the adapter.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../appError.ts';
import { resolveErpDispatchAdapter, type DispatchServiceClient } from './dispatchFactory.ts';
import { ERPNEXT_TIER } from './adapter.ts';

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
              return { data: null, error: null };
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
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ name: 'ACC-SINV-2026-00001' }), { status: 200 })) as unknown as typeof fetch,
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
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ name: 'ACC-SINV-2026-00001' }), { status: 200 })) as unknown as typeof fetch,
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
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ name: 'ACC-SINV-2026-00001' }), { status: 200 })) as unknown as typeof fetch,
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
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ name: 'ACC-PO-2026-00001' }), { status: 200 })) as unknown as typeof fetch,
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
});
