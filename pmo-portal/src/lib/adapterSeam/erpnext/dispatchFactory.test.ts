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

  /** The link-table rows behind the org-scoped pre-flight (Luna B2): `<table>:<id>` -> the row's REAL
   *  org_id. org-1 is the caller's org in these tests; org-2 is a DIFFERENT tenant, so a cross-org id
   *  is distinguishable from a same-org one by the id ALONE — an org-blind fake (one canned org_id per
   *  table) could not tell them apart and so could not prove the guard. */
  const TWO_ORG_ROWS: Record<string, { org_id: string }> = {
    'companies:cust-1': { org_id: 'org-1' },
    'companies:cust-org2': { org_id: 'org-2' },
    'projects:proj-1': { org_id: 'org-1' },
    'projects:proj-org2': { org_id: 'org-2' },
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
      fetchImpl: vi.fn() as unknown as typeof fetch,
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
      fetchImpl: vi.fn() as unknown as typeof fetch,
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
      fetchImpl: vi.fn() as unknown as typeof fetch,
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
