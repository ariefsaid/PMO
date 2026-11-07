/** Contract-test adapter selection through the shipped Edge Function resolver and a tenant-scoped service client. */
import { resolveOdooProcurementAdapter } from '../../../../../supabase/functions/adapter-dispatch/odooAdapters.ts';
import { assertCommandLinksSameOrg } from '../erpnext/dispatchPreflight.ts';
import { createFakeOdoo } from './fakeOdoo.ts';
import type { LinkOwner, PreflightResult, ProcurementPushScenario, PushBeforeConnectionResult } from '../contractSuite/harness.ts';

declare global {
  const Deno: {
    env: { get(name: string): string | undefined };
    errors: { NotFound: new (message?: string) => Error };
  };
}

const KEY = 'contract-test-key';
const ORG: Record<'A' | 'B', string> = { A: 'org-a', B: 'org-b' };
const CASE: Record<'A' | 'B', string> = { A: 'case-a', B: 'case-b' };
const VENDOR: Record<'A' | 'B', string> = { A: 'vendor-a', B: 'vendor-b' };
const BILL: Record<'A' | 'B', string> = { A: 'bill-a', B: 'bill-b' };
const ID = '123e4567-e89b-42d3-a456-426614174000';
const CAPABILITIES = {
  later: { 'purchase.order': true, 'purchase.order.line': true, 'stock.picking': true, 'stock.move': true, 'account.move': true, 'account.payment': true },
  models: { 'account.journal': { exists: true, read: true } },
};

type Row = Record<string, unknown>;
type Connection = 'activated' | 'not-activated' | 'absent';

function belongs(owner: LinkOwner | undefined, caller: 'A' | 'B'): string | undefined {
  if (owner === 'nobody') return 'missing-record';   // a command naming a record that does not exist
  const tenant = owner === 'A' || owner === 'B' ? owner : caller;
  return CASE[tenant];
}

function vendorId(owner: LinkOwner | undefined, fallback: 'A' | 'B'): string {
  if (owner === 'nobody') return 'missing-vendor';
  const tenant = owner === 'A' || owner === 'B' ? owner : fallback;
  return VENDOR[tenant];
}

function scopedServiceClient(connection: Connection, scenario?: ProcurementPushScenario) {
  const bindings = connection === 'absent' ? [] : (['A', 'B'] as const).map((tenant) => ({
    id: `binding-${tenant.toLowerCase()}`,
    org_id: ORG[tenant],
    external_tier: 'odoo',
    site_url: 'https://8.8.8.8',
    secret_ref: `secret-${tenant.toLowerCase()}`,
    status: 'active',
    activated_at: connection === 'activated' ? '2026-11-01T00:00:00Z' : null,
    config: {
      database: 'contract-test',
      odoo_company_id: 1,
      capabilities: CAPABILITIES,
      item_map: { 'Cable tray': '55' },
      default_payment_journal_id: 7,
      purchase_tax_ids: [],
    },
  }));
  const rows: Record<string, Row[]> = {
    external_org_bindings: bindings,
    procurements: (['A', 'B'] as const).map((tenant) => ({
      org_id: ORG[tenant], id: CASE[tenant], code: `PRC-${tenant}`, project_id: null,
      vendor_id: tenant === scenario?.caller && scenario.procurement === tenant && scenario.vendor
        ? vendorId(scenario.vendor, tenant)
        : VENDOR[tenant],
      currency: 'IDR',
    })),
    procurement_items: (['A', 'B'] as const).map((tenant) => ({
      org_id: ORG[tenant], procurement_id: CASE[tenant], name: 'Cable tray', quantity: 1, rate: 50, description: null,
    })),
    procurement_invoices: (['A', 'B'] as const).map((tenant) => ({
      org_id: ORG[tenant], id: BILL[tenant], procurement_id: CASE[tenant],
    })),
    companies: (['A', 'B'] as const).map((tenant) => ({ org_id: ORG[tenant], id: VENDOR[tenant] })),
    external_refs: [
      ...(['A', 'B'] as const).flatMap((tenant) => [
        { org_id: ORG[tenant], external_tier: 'odoo', domain: 'companies', pmo_record_id: VENDOR[tenant], external_record_id: 'Vendor:9' },
        { org_id: ORG[tenant], external_tier: 'odoo', domain: 'procurement', pmo_record_id: BILL[tenant], external_record_id: 'account.move:301' },
      ]),
    ],
    purchase_orders: [],
    external_project_bindings: [],
    external_master_records: [],
    external_command_outbox: [],
  };

  const queryRows = (table: string, filters: Record<string, unknown>, inFilters: Record<string, unknown[]>) =>
    (rows[table] ?? []).filter((row) =>
      Object.entries(filters).every(([column, value]) => row[column] === value) &&
      Object.entries(inFilters).every(([column, values]) => values.includes(row[column])),
    );

  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const inFilters: Record<string, unknown[]> = {};
      const builder = {
        select: () => builder,
        eq(column: string, value: unknown) { filters[column] = value; return builder; },
        in(column: string, values: unknown[]) { inFilters[column] = values; return builder; },
        order: () => builder,
        limit: () => builder,
        async maybeSingle() { return { data: queryRows(table, filters, inFilters)[0] ?? null, error: null }; },
        then(resolve: (value: { data: Row[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve({ data: queryRows(table, filters, inFilters), error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
    async rpc(name: string) {
      return name === 'read_vault_secret' ? { data: KEY, error: null } : { data: null, error: null };
    },
  };
}

function productionWorld() {
  const fake = createFakeOdoo({ key: KEY });
  fake.seed('res.company', [{ id: 1, name: 'Contract Co', currency_id: [12, 'IDR'] }]);
  fake.seed('res.currency', [{ id: 12, name: 'IDR', rounding: 1, decimal_places: 0, active: true }]);
  fake.seed('res.partner', [{ id: 9, name: 'Contract Vendor', is_company: true, supplier_rank: 1, active: true }]);
  fake.seed('product.product', [{ id: 55, name: 'Cable tray', supplier_taxes_id: [], purchase_ok: true }]);
  fake.seed('account.journal', [{ id: 7, name: 'Bank', type: 'bank', active: true, outbound_payment_method_line_ids: [31], company_id: 1 }]);
  fake.seed('account.move', [{ id: 301, name: 'BILL-301', move_type: 'in_invoice', state: 'posted', partner_id: [9, 'Contract Vendor'], amount_residual: 50, currency_id: [12, 'IDR'], company_id: 1, invoice_line_ids: [] }]);
  fake.seed('account.move.line', [{ id: 302, move_id: 301, display_type: 'payment_term', account_type: 'liability_payable', balance: -50, amount_residual: -50, reconciled: false }]);
  return fake;
}

const linkId = (owner: LinkOwner | undefined, caller: 'A' | 'B') => {
  if (owner === 'nobody') return 'missing-record';
  const tenant = owner === 'A' || owner === 'B' ? owner : caller;
  return CASE[tenant];
};

function commandFor(scenario: ProcurementPushScenario, tenant: 'A' | 'B') {
  const procurementId = scenario.procurement === undefined ? undefined : belongs(scenario.procurement, tenant);
  const record: Record<string, unknown> = {
    id: ID,
    procurementId,
    erp_doc_kind: scenario.doc === 'bill' ? 'purchase-invoice' : scenario.doc === 'vendor-payment' ? 'payment' : scenario.doc,
  };
  if (scenario.vendor !== undefined) record.vendorId = vendorId(scenario.vendor, tenant);
  if (scenario.doc === 'vendor-payment') {
    record.invoiceId = linkId(scenario.invoice, tenant).replace('case-', 'bill-');
    record.paid_amount = '50.00';
    record.date = '2026-11-05';
  }
  return {
    domain: 'procurement',
    operation: 'create',
    idempotencyKey: `contract:${scenario.doc}:${tenant}`,
    record,
  };
}

async function withRuntime<T>(fake: ReturnType<typeof productionWorld>, action: () => Promise<T>): Promise<T> {
  const root = globalThis as typeof globalThis & { Deno?: { env: { get(name: string): string | undefined } } };
  const priorDeno = root.Deno;
  const priorFetch = globalThis.fetch;
  root.Deno = { env: { get: (name) => name === 'EXTERNAL_CONNECT_ENABLED' ? '1' : undefined } };
  globalThis.fetch = fake.fetch;
  try { return await action(); }
  finally {
    globalThis.fetch = priorFetch;
    if (priorDeno === undefined) delete root.Deno;
    else root.Deno = priorDeno;
  }
}

async function runProduction(command: ReturnType<typeof commandFor>, caller: 'A' | 'B', connection: Connection, scenario?: ProcurementPushScenario): Promise<PreflightResult> {
  const fake = productionWorld();
  return withRuntime(fake, async () => {
    try {
      const adapter = await resolveOdooProcurementAdapter({
        orgId: ORG[caller], serviceClient: scopedServiceClient(connection, scenario) as never, userId: `user-${caller}`,
        faultGate: { envFaults: undefined, header: null, requestHost: null, allowedHosts: undefined },
        erpAuth: new Map(), command: command as never,
      });
      await adapter.commit(command as never);
      return { outcome: 'accepted', erpCalls: fake.calls.length };
    } catch (error) {
      const candidate = error as { code?: unknown; message?: unknown };
      return {
        outcome: 'refused',
        code: typeof candidate.code === 'string' ? candidate.code : 'commit-rejected',
        message: typeof candidate.message === 'string' ? candidate.message : 'purchase command failed',
        erpCalls: fake.calls.length,
      };
    }
  });
}

export async function productionPurchase(connection: Connection): Promise<PushBeforeConnectionResult> {
  const scenario: ProcurementPushScenario = { doc: 'purchase-order', caller: 'A', procurement: 'A' };
  const result = await runProduction(commandFor(scenario, 'A'), 'A', connection, scenario);
  return { outcome: result.outcome === 'accepted' ? 'pushed' : 'refused', code: result.code, erpCalls: result.erpCalls };
}

/** A command that names no procurement link has nothing for adapter selection to refuse on ownership: it passes the shared link check untouched. */
async function linkCheckOnly(command: ReturnType<typeof commandFor>, caller: 'A' | 'B'): Promise<PreflightResult> {
  try {
    await assertCommandLinksSameOrg({ command: command as never, serviceClient: scopedServiceClient('activated') as never, orgId: ORG[caller] });
    return { outcome: 'accepted', erpCalls: 0 };
  } catch (error) {
    return { outcome: 'refused', code: (error as { code?: string }).code, message: (error as Error).message, erpCalls: 0 };
  }
}

export function productionProcurement(scenario: ProcurementPushScenario): Promise<PreflightResult> {
  const command = commandFor(scenario, scenario.caller);
  const { procurementId, vendorId: vendor, invoiceId } = command.record as Record<string, unknown>;
  if (procurementId === undefined && vendor === undefined && invoiceId === undefined) return linkCheckOnly(command, scenario.caller);
  return runProduction(commandFor(scenario, scenario.caller), scenario.caller, 'activated', scenario);
}
