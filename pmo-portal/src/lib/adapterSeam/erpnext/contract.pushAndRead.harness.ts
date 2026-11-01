/**
 * ERPNext's harness for the push preflights and reads of the shared suites (spec §6.2): drives the SHIPPED dispatch
 * factory and feed code with the transport mocked and answers in PMO terms. No behaviour lives here.
 */
import type { AdapterCommand } from '../contract.ts';
import type { BudgetVersionScenario, ErpHarness, LinkOwner, PreflightResult, ProcurementPushScenario, RevenuePushScenario, Tenant, TimesheetPushScenario } from '../contractSuite/harness.ts';
import { classifyPayment, mirrorPurchases, readActuals } from './contract.reads.harness.ts';
import { DOCTYPE_BODIES } from './doctypeBodies.ts';
import { resolveErpDispatchAdapter, type DispatchServiceClient } from './dispatchFactory.ts';

type PushAndRead = Pick<ErpHarness, 'pushTimesheet' | 'pushProcurement' | 'pushRevenue' | 'pushBudgetVersion' | 'readActuals' | 'classifyPayment' | 'mirrorPurchases'>;

/** Counts every call that reaches the (fake) ERP. */
function countingTransport() {
  const stats = { calls: 0 };
  const fetchImpl = (async () => { stats.calls += 1; return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
  return { stats, fetchImpl };
}

/** Resolve the dispatch adapter for a command; a refusal is the classified code, with the ERP calls it cost. */
async function preflight(serviceClient: DispatchServiceClient, orgId: string, command: AdapterCommand): Promise<PreflightResult> {
  const { stats, fetchImpl } = countingTransport();
  try {
    await resolveErpDispatchAdapter({ serviceClient, orgId, command, fetchImpl, apiKey: 'k', apiSecret: 's' });
    return { outcome: 'accepted', erpCalls: stats.calls };
  } catch (error) {
    const e = error as Error & { code?: string };
    return { outcome: 'refused', code: e.code, message: e.message, erpCalls: stats.calls };
  }
}

// --- timesheet.push -----------------------------------------------------------------------------------------------

const TIMESHEET_BINDING = {
  site_url: 'https://erp.example.com', version_major: 15, activated_at: '2026-07-20T00:00:00.000Z',
  config: {
    company: 'PMO Smoke Co', default_activity_type: 'Execution', timesheet_day_start: '09:00:00',
    project_map: { 'proj-a': 'PROJ-0001', 'proj-b': 'PROJ-0002' },
  },
};

interface TimesheetRows { binding: unknown; employee?: { id: string; org_id: string; profile_id: string; link_state: string; employee_number: string }; refs: Record<string, string> }

/** A table-aware fake that honours the query's OWN filters, so a refusal comes from the query, not an absent fixture. */
function timesheetClient(rows: TimesheetRows): DispatchServiceClient {
  return {
    from(table: string) {
      const filters: Record<string, string> = {};
      const builder = {
        eq(column: string, value: string) { filters[column] = value; return builder; },
        order: () => builder,
        limit: () => builder,
        async maybeSingle() {
          if (table === 'external_org_bindings') return { data: rows.binding, error: null };
          if (table === 'erp_employees') {
            const row = rows.employee;
            const match = row
              && (filters.org_id === undefined || row.org_id === filters.org_id)
              && (filters.profile_id === undefined || row.profile_id === filters.profile_id)
              && (filters.link_state === undefined || row.link_state === filters.link_state);
            return { data: match ? row : null, error: null };
          }
          if (table === 'external_refs') {
            const value = rows.refs[filters.pmo_record_id ?? ''];
            return { data: value ? { external_record_id: value } : null, error: null };
          }
          return { data: null, error: null };
        },
        then(onFulfilled: (v: { data: unknown; error: null }) => unknown) { return Promise.resolve({ data: [], error: null }).then(onFulfilled); },
      };
      return { select: () => builder };
    },
  } as unknown as DispatchServiceClient;
}

const TIMESHEET_PROJECT: Record<TimesheetPushScenario['entries'][number]['project'], { id: string; org: string }> = {
  'a': { id: 'proj-a', org: 'org-1' }, 'b': { id: 'proj-b', org: 'org-1' },
  'unmapped': { id: 'proj-unknown', org: 'org-1' }, 'other-tenant': { id: 'proj-a', org: 'org-2' },
};

function pushTimesheet(s: TimesheetPushScenario): Promise<PreflightResult> {
  const employee = s.employeeLink === 'none' ? undefined : {
    id: 'emp-row-1', employee_number: 'HR-EMP-00001', profile_id: 'user-1',
    org_id: s.employeeLink === 'other-tenant' ? 'org-2' : 'org-1',
    link_state: s.employeeLink === 'proposed' ? 'proposed' : 'confirmed',
  };
  const { default_activity_type: _kept, ...withoutActivity } = TIMESHEET_BINDING.config;
  const binding = { ...TIMESHEET_BINDING, config: s.activityType === 'configured' ? TIMESHEET_BINDING.config : withoutActivity };
  const refs: Record<string, string> = s.employeeLink === 'confirmed-without-erp-id' ? {} : { 'emp-row-1': 'Employee:HR-EMP-00001' };
  return preflight(timesheetClient({ binding, employee, refs }), 'org-1', {
    domain: 'timesheets', operation: 'create',
    record: {
      id: 'ts-1', erp_doc_kind: 'timesheet', user_id: 'user-1', approved_at: '2026-01-12T03:04:05Z',
      entries: s.entries.map((e) => ({ project_id: TIMESHEET_PROJECT[e.project].id, entry_date: e.date, hours: e.hours, project_org_id: TIMESHEET_PROJECT[e.project].org })),
    },
  });
}

// --- purchase.push, bill.push, vendor-payment.push ---------------------------------------------------------------

const PROCUREMENT_BINDING = {
  site_url: 'https://erp.example.com', version_major: 15, activated_at: '2026-07-11T00:00:00.000Z',
  config: { company: 'PMO Smoke Co', default_payable_account: 'Creditors - PSC' },
};

/** `<table>:<id>` -> the row's REAL org_id, so a link owned by the other tenant is told apart by its id alone. */
const TWO_TENANT_ROWS: Record<string, { org_id: string } & Record<string, unknown>> = {
  'organizations:org-1': { org_id: 'org-1', default_currency: 'IDR' },
  'procurements:proc-1': { org_id: 'org-1' },
  'procurements:proc-org2': { org_id: 'org-2' },
  'companies:vendor-1': { org_id: 'org-1' },
  'companies:vendor-org2': { org_id: 'org-2' },
  'procurement_invoices:vi-1': { org_id: 'org-1', procurement_id: 'proc-1', erp_outstanding_amount: 1090000, vi_number: 'ACC-PINV-2026-00001', currency: 'IDR' },
  'procurement_invoices:vi-org2': { org_id: 'org-2' },
};

function procurementClient(): DispatchServiceClient {
  return {
    from: (table: string) => ({
      select: () => {
        let filters: Record<string, string> = {};
        const chain = {
          eq: (col: string, val: string) => { filters = { ...filters, [col]: val }; return chain; },
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => {
            if (table === 'external_org_bindings') return { data: PROCUREMENT_BINDING, error: null };
            if (table === 'external_refs') {
              // The payment gate resolves the bill's ERP name; every other reference stays empty.
              const mapped = filters.domain === 'procurement' && filters.pmo_record_id === 'vi-1';
              return { data: mapped ? { external_record_id: 'ACC-PINV-2026-00001' } : null, error: null };
            }
            return { data: TWO_TENANT_ROWS[`${table}:${filters.id}`] ?? null, error: null };
          },
          then: (resolve: (v: { data: unknown; error: null }) => unknown) => resolve({ data: [], error: null }),
        };
        return chain;
      },
    }),
  } as unknown as DispatchServiceClient;
}

const ORG: Record<Tenant, string> = { A: 'org-1', B: 'org-2' };
const PROCUREMENT_ID: Record<LinkOwner, string> = { A: 'proc-1', B: 'proc-org2', nobody: 'proc-nope' };
const VENDOR_ID: Record<LinkOwner, string> = { A: 'vendor-1', B: 'vendor-org2', nobody: 'vendor-nope' };
const INVOICE_ID: Record<LinkOwner, string> = { A: 'vi-1', B: 'vi-org2', nobody: 'vi-nope' };
const ERP_DOC_KIND: Record<ProcurementPushScenario['doc'], string> = {
  'purchase-order': 'purchase-order', 'quotation': 'quotation', 'bill': 'purchase-invoice', 'vendor-payment': 'payment', 'supplier': 'supplier',
};

function pushProcurement(s: ProcurementPushScenario): Promise<PreflightResult> {
  const record: Record<string, unknown> = { id: 'pmo-1', erp_doc_kind: ERP_DOC_KIND[s.doc] };
  if (s.procurement) record.procurementId = PROCUREMENT_ID[s.procurement];
  if (s.vendor) record.vendorId = VENDOR_ID[s.vendor];
  if (s.invoice) record.invoiceId = INVOICE_ID[s.invoice];
  if (s.doc === 'supplier') record.name = 'Acme';
  if (s.doc === 'vendor-payment') Object.assign(record, { paid_amount: 1090000, date: '2026-10-08' });
  return preflight(procurementClient(), ORG[s.caller], { domain: 'procurement', operation: 'create', record } as AdapterCommand);
}

// --- invoice.push ---------------------------------------------------------------------------------------------------

const REVENUE_BINDING = {
  site_url: 'https://erp.example.com', version_major: 15, activated_at: '2026-07-11T00:00:00.000Z',
  config: {
    company: 'PMO Smoke Co', default_receivable_account: 'Debtors - PSC', default_income_account: 'Sales - PSC',
    default_cash_account: 'Cash - PSC', default_bank_account: 'Bank - PSC', project_map: { 'proj-1': 'PROJ-0001' },
  },
};

const REVENUE_ROWS: Record<string, { org_id: string; currency?: string; default_currency?: string; subject_to_vat?: boolean }> = {
  'companies:cust-1': { org_id: 'org-1' },
  'companies:cust-org2': { org_id: 'org-2' },
  'projects:proj-1': { org_id: 'org-1', currency: 'USD', subject_to_vat: true },
  'projects:proj-org2': { org_id: 'org-2' },
  'organizations:org-2': { org_id: 'org-2', default_currency: 'USD' },
  'organizations:org-1': { org_id: 'org-1', default_currency: 'USD' },
  'sales_invoices:si-1': { org_id: 'org-1' },
  'sales_invoices:si-org2': { org_id: 'org-2' },
};

const REVENUE_REFS: Record<string, { external_record_id: string }> = {
  'companies:cust-1': { external_record_id: 'Customer:Spike Customer' },
  'companies:cust-org2': { external_record_id: 'Customer:Other Tenant Customer' },
  'revenue:si-1': { external_record_id: 'ACC-SINV-2026-00001' },
  'revenue:si-org2': { external_record_id: 'ACC-SINV-2026-09999' },
};

function revenueClient(): DispatchServiceClient {
  return {
    from: (table: string) => ({
      select: () => {
        let filters: Record<string, string> = {};
        const chain = {
          eq: (col: string, val: string) => { filters = { ...filters, [col]: val }; return chain; },
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => {
            if (table === 'external_org_bindings') return { data: REVENUE_BINDING, error: null };
            if (table === 'external_refs') return { data: REVENUE_REFS[`${filters.domain}:${filters.pmo_record_id}`] ?? null, error: null };
            return { data: REVENUE_ROWS[`${table}:${filters.id}`] ?? null, error: null };
          },
        };
        return chain;
      },
    }),
  } as unknown as DispatchServiceClient;
}

const CUSTOMER_ID: Record<LinkOwner, string> = { A: 'cust-1', B: 'cust-org2', nobody: 'cust-does-not-exist' };
const REVENUE_PROJECT_ID: Record<LinkOwner, string> = { A: 'proj-1', B: 'proj-org2', nobody: 'proj-nope' };
const SALES_INVOICE_ID: Record<LinkOwner, string> = { A: 'si-1', B: 'si-org2', nobody: 'si-nope' };

/** The ERP answers the lookups an invoice create makes (billing currency, default tax template) with one fixed shape. */
function revenueTransport() {
  const stats = { calls: 0 };
  const fetchImpl = (async (url: string) => {
    stats.calls += 1;
    const path = decodeURIComponent(new URL(url).pathname);
    if (path.startsWith('/api/resource/Customer/') || path.startsWith('/api/resource/Company/')) return Response.json({ data: { default_currency: 'USD' } });
    if (path === '/api/resource/Sales Taxes and Charges Template') return Response.json({ data: [{ name: 'Smoke Tax' }] });
    if (path === '/api/resource/Sales Taxes and Charges Template/Smoke Tax') {
      return Response.json({ data: { name: 'Smoke Tax', taxes: [{ charge_type: 'On Net Total', account_head: 'VAT - PSC', rate: 11 }] } });
    }
    return Response.json({});
  }) as unknown as typeof fetch;
  return { stats, fetchImpl };
}

async function pushRevenue(s: RevenuePushScenario): Promise<PreflightResult> {
  const { stats, fetchImpl } = revenueTransport();
  const record: Record<string, unknown> = { id: 'pmo-1', erp_doc_kind: s.doc === 'receipt' ? 'incoming-payment' : 'sales-invoice' };
  if (s.customer) record.customerId = CUSTOMER_ID[s.customer];
  if (s.project) record.projectId = REVENUE_PROJECT_ID[s.project];
  if (s.salesInvoice) record.salesInvoiceId = SALES_INVOICE_ID[s.salesInvoice];
  if (s.doc === 'receipt') Object.assign(record, { paid_amount: 100, date: '2026-07-16' });
  else record.items = [];
  try {
    await resolveErpDispatchAdapter({
      serviceClient: revenueClient(), orgId: ORG[s.caller], command: { domain: 'revenue', operation: 'create', record } as AdapterCommand,
      fetchImpl, apiKey: 'k', apiSecret: 's',
    });
    return { outcome: 'accepted', erpCalls: stats.calls };
  } catch (error) {
    const e = error as Error & { code?: string };
    return { outcome: 'refused', code: e.code, message: e.message, erpCalls: stats.calls };
  }
}

// --- budget.push ----------------------------------------------------------------------------------------------------

const BUDGET_BINDING = {
  site_url: 'https://erp.example.com', version_major: 15, activated_at: '2026-07-11T00:00:00.000Z',
  config: { company: 'PMO Smoke Co', project_map: { 'proj-1': 'PROJ-0001' } },
};
const BUDGET_PROJECT: Record<'own' | 'other-tenant', string> = { 'own': 'proj-1', 'other-tenant': 'proj-org2' };
const BUDGET_PROJECT_ROWS: Record<string, { org_id: string }> = { 'projects:proj-1': { org_id: 'org-1' }, 'projects:proj-org2': { org_id: 'org-2' } };

function budgetClient(mapRows: unknown[]): DispatchServiceClient {
  return {
    from: (table: string) => ({
      select: () => {
        let filters: Record<string, string> = {};
        const chain = {
          eq: (col: string, val: string) => { filters = { ...filters, [col]: val }; return chain; },
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => {
            if (table === 'external_org_bindings') return { data: BUDGET_BINDING, error: null };
            // The ownership witness: every scenario here is PMO revising a budget PMO itself pushed.
            if (table === 'external_refs') return { data: filters.external_record_id ? { pmo_record_id: 'ver-previous' } : null, error: null };
            return { data: BUDGET_PROJECT_ROWS[`${table}:${filters.id}`] ?? null, error: null };
          },
          then: (resolve: (v: { data: unknown; error: null }) => unknown) => resolve({ data: table === 'budget_category_account_map' ? mapRows : [], error: null }),
        };
        return chain;
      },
    }),
  } as unknown as DispatchServiceClient;
}

async function pushBudgetVersion(s: BudgetVersionScenario): Promise<PreflightResult> {
  const stats = { calls: 0 };
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    stats.calls += 1;
    if (init?.method === 'POST') return new Response(JSON.stringify({ name: 'BUDGET-2026-00001' }), { status: 200 });
    if (init?.method === 'PUT') return new Response(JSON.stringify({ name: 'BUDGET-2026-00001', docstatus: 1 }), { status: 200 });
    return new Response(JSON.stringify({ name: 'BUDGET-2026-00001', docstatus: 1, modified: '2026-07-20 10:00:00', fiscal_year: '2026' }), { status: 200 });
  }) as unknown as typeof fetch;
  const record: Record<string, unknown> = {
    id: 'ver-1', erp_doc_kind: 'budget', fiscal_year: '2026',
    line_items: s.categories.map((category) => ({ category, budgeted_amount: '1000.00' })),
  };
  if (s.project !== 'none') record.projectId = BUDGET_PROJECT[s.project];
  const mapRows = s.mappedCategories.map((category) => ({ category, erp_account: `${category} - PSC` }));
  const command = { domain: 'budget', operation: 'create', record } as AdapterCommand;
  try {
    const adapter = await resolveErpDispatchAdapter({
      serviceClient: budgetClient(mapRows), orgId: 'org-1', command, fetchImpl, apiKey: 'k', apiSecret: 's', doctypeBodies: DOCTYPE_BODIES,
    });
    await adapter.commit({ ...command, idempotencyKey: '11111111-1111-4111-8111-111111111111' } as never);
    return { outcome: 'accepted', erpCalls: stats.calls };
  } catch (error) {
    const e = error as Error & { code?: string };
    return { outcome: 'refused', code: e.code, message: e.message, erpCalls: stats.calls };
  }
}

export function createPushAndReadHarness(): PushAndRead {
  return {
    pushTimesheet,
    pushProcurement,
    pushRevenue,
    pushBudgetVersion,
    readActuals,
    classifyPayment,
    mirrorPurchases,
  };
}
