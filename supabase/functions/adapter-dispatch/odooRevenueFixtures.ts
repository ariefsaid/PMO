// Shared world for the Odoo revenue dispatch tests (odooRevenueGates.test.ts, odooInvoiceSodGate.served.test.ts): every route is a FACT the
// shipped handler reads. A read no route answers lands in `unexpected` (add a route that answers it as a fact; never loosen an assertion).
import { jsonResponse, supabaseRpc, supabaseSelect, type FetchCall, type MockRoute } from '../_shared/testing/edgeTestKit.ts';
import { createFakeOdoo } from '../../../pmo-portal/src/lib/adapterSeam/odoo/fakeOdoo.ts';

export const ORG_ID = '11111111-1111-4111-8111-111111111111';
export const AUTHOR_ID = '22222222-2222-4222-8222-222222222222';
export const APPROVER_ID = '33333333-3333-4333-8333-333333333333';
export const CUSTOMER_ID = '44444444-4444-4444-8444-444444444444';
export const PROJECT_ID = '55555555-5555-4555-8555-555555555555';
export const WORK_ORDER_ID = '66666666-6666-4666-8666-666666666666';
/** A new invoice a create pushes, and an existing one (posted in Odoo) that a receipt settles and an approval transitions. */
export const NEW_INVOICE_ID = '77777777-7777-4777-8777-777777777700';
export const INVOICE_ID = '77777777-7777-4777-8777-777777777777';
/** An invoice DRAFT (PMO's alone until its approval, OQ-OCI-1): no Odoo document, no mapping. */
export const DRAFT_ID = '77777777-7777-4777-8777-777777777701';
export const RECEIPT_ID = '88888888-8888-4888-8888-888888888888';
export const FOREIGN_ORG_ID = '99999999-9999-4999-8999-999999999999';
export const ODOO_HOST = 'odoo.example.test';
const ODOO_TIER_NAME = 'odoo';

/** What discovery stores for an Odoo connection that can invoice (REVENUE_MODELS). */
export const REVENUE_SNAPSHOT = {
  later: { 'account.move': true, 'account.move.line': true, 'account.payment': true },
  models: { 'account.journal': { exists: true, read: true }, 'account.tax': { exists: true, read: true }, 'account.account': { exists: true, read: true } },
};

export type Tier = 'odoo' | 'erpnext';
export interface World {
  owns?: Tier[];
  role?: string;
  /** `get_process_gates`; 'unreadable' fails the RPC. */
  gates?: { require_project_on_si?: boolean } | 'unreadable';
  /** `<table>:<id>` -> owning org (null: no such row). Unlisted rows belong to ORG_ID. */
  rows?: Record<string, string | null>;
  /** sales_invoices.customer_id of a receipt's invoice. */
  invoiceCustomer?: string | null;
  /** Whether the invoice a receipt settles has an Odoo reference. */
  invoiceInOdoo?: boolean;
  /** The tier the invoice's reference was recorded under (default 'odoo'); a lookup that filters on `external_tier` only sees its own tier's row. */
  invoiceRefTier?: Tier;
  snapshot?: unknown;
  odooBinding?: Record<string, unknown> | null;
  /** The Odoo cost account the project is linked to (null: unlinked) and what the mirror says about it. */
  projectLink?: string | null;
  account?: { active: boolean; tombstoned_at: string | null } | null;
  /** The invoice's author: the clearance grant refuses this user (the database rule, as a fact). */
  invoiceAuthor?: string;
  /** Out: the actors the clearance grant was called for. */
  grants?: string[];
  /** The PMO draft row an approval reads its lines from (default: a two-line draft; null: no such row). */
  draft?: Record<string, unknown> | null;
  /** The fake Odoo behind the Odoo host (an approval talks to it over fetch). */
  odoo?: { fetch: (url: string, init?: RequestInit) => Promise<Response> };
  /** The org's default sale tax is mirrored as a PPN output tax (default true) / absent. */
  saleTax?: 'ppn' | 'collector' | 'absent';
  /** Out: every write to the draft tables, in order. */
  writes?: Array<{ table: string; method: string; body: unknown }>;
  /** The draft is mapped to its Odoo document (a retry after the approval succeeded). */
  draftMapped?: boolean;
  /** Shared outbox rows across dispatches (a retry meets the world its first attempt left). */
  outbox?: Map<string, Record<string, unknown>>;
  /** A submit clearance can be outstanding before the approval has inserted its outbox row. */
  approvalClearance?: boolean;
}

export const draftRow = (over: Record<string, unknown> = {}) => ({
  id: DRAFT_ID, customer_id: CUSTOMER_ID, project_id: PROJECT_ID, work_order_id: WORK_ORDER_ID, reference_number: null, invoice_date: '2026-11-03', currency: 'IDR',
  status: 'Draft', erp_docstatus: null, pmo_native: false,
  native_lines: [{ item_code: 'ITEM-A', description: 'BoQ 1', qty: 4, rate: 250, amount: 1000 }, { item_code: 'ITEM-A', description: 'BoQ 2', qty: 2, rate: 500, amount: 1000 }],
  ...over,
});
export const draftItems = [{ item_code: 'ITEM-A', qty: 4, rate: 250, description: 'BoQ 1' }, { item_code: 'ITEM-A', qty: 2, rate: 500, description: 'BoQ 2' }];

export const objectResponse = (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
export const nullObjectResponse = () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
export const param = (call: FetchCall, key: string): string | null => {
  const raw = call.url.searchParams.get(key);
  return raw?.startsWith('eq.') ? decodeURIComponent(raw.slice(3)) : raw;
};

export const invoiceCommand = (record: Record<string, unknown> = {}, operation = 'create') => ({
  domain: 'revenue', operation, idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-000000001506',
  record: { id: NEW_INVOICE_ID, erp_doc_kind: 'sales-invoice', customerId: CUSTOMER_ID, projectId: PROJECT_ID, workOrderId: WORK_ORDER_ID, ...record },
});
export const receiptCommand = (record: Record<string, unknown> = {}) => ({
  domain: 'revenue', operation: 'create', idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-000000001507',
  record: { id: RECEIPT_ID, erp_doc_kind: 'incoming-payment', customerId: CUSTOMER_ID, salesInvoiceId: INVOICE_ID, amount: 100, ...record },
});
export const submitCommand = (record: Record<string, unknown> = {}) => invoiceCommand({ id: INVOICE_ID, verb: 'submit', ...record }, 'transition');
/** Authoring a draft: the lines travel on a create, and nothing reaches Odoo. */
export const draftCommand = (record: Record<string, unknown> = {}) => invoiceCommand({ items: draftItems, ...record });
/** The approval of a draft: the one command that pushes (and so the one the SoD gate guards). The payload claims nothing the draft does not say. */
export const approveCommand = (record: Record<string, unknown> = {}) => ({
  domain: 'revenue', operation: 'transition', idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-000000001508',
  record: { id: DRAFT_ID, erp_doc_kind: 'sales-invoice', verb: 'submit', ...record },
});

export function revenueRoutes(unexpected: FetchCall[], caller: string, world: World): MockRoute[] {
  const owns: Tier[] = world.owns ?? ['odoo'];
  // a lookup, not a comparison against a tier name (AC-ECA-043)
  const ownsTier = (tier: Tier) => owns.some((t) => t.localeCompare(tier) === 0);
  const outbox = world.outbox ?? new Map<string, Record<string, unknown>>();
  const orgOf = (table: string, id: string | null) => world.rows && `${table}:${id}` in world.rows ? world.rows[`${table}:${id}`] : ORG_ID;
  const owned = (table: string) => supabaseSelect(table, (call) => {
    const select = call.url.searchParams.get('select') ?? '';
    const id = param(call, 'id');
    // the native-row guard reads `id, pmo_native`; the receipt scope reads `customer_id`; the link pre-flight reads `org_id`
    if (table === 'sales_invoices' && select.includes('native_lines')) return world.draft === null || (id !== DRAFT_ID) ? nullObjectResponse() : objectResponse(world.draft ?? draftRow());
    if (select.includes('pmo_native')) return nullObjectResponse();
    if (select === 'project_id') return objectResponse({ project_id: PROJECT_ID });   // the submit-time process gate reads the mirror row's project
    if (table === 'projects' && select.includes('subject_to_vat')) return objectResponse({ subject_to_vat: true, customer_contract_ref: 'CT-1' });
    if (table === 'work_orders' && select.includes('client_po_number')) return objectResponse({ client_po_number: 'WO-PO-9' });
    if (select.includes('customer_id')) return table === 'sales_invoices' && orgOf(table, id) !== null ? objectResponse({ customer_id: world.invoiceCustomer === undefined ? CUSTOMER_ID : world.invoiceCustomer }) : nullObjectResponse();
    const org = orgOf(table, id);
    return org === null ? nullObjectResponse() : objectResponse({ org_id: org });
  });
  const bindingTiers = new Set<string>([ODOO_TIER_NAME]);
  return [
    supabaseSelect('profiles', (call) => call.url.searchParams.has('role') ? jsonResponse([{ id: caller }]) : objectResponse({ org_id: ORG_ID })),
    supabaseRpc('domain_owned_by_tier', (call) => jsonResponse(owns.includes((call.bodyJson as { p_tier: Tier }).p_tier))),
    supabaseRpc('org_has_active_erpnext_binding', () => jsonResponse(ownsTier('erpnext'))),
    supabaseRpc('actor_authorization_state', () => jsonResponse({ role: world.role ?? 'Finance', active: true })),
    supabaseRpc('get_process_gates', () => world.gates === 'unreadable' ? jsonResponse({ message: 'boom' }, { status: 500 }) : jsonResponse({ require_project_on_si: true, ...world.gates })),
    supabaseRpc('claim_sales_invoice_author', () => jsonResponse(null)),
    supabaseRpc('grant_sales_invoice_submit_clearance', (call) => {
      const actor = (call.bodyJson as { p_actor_id: string }).p_actor_id;
      world.grants?.push(actor);
      return actor === (world.invoiceAuthor ?? AUTHOR_ID)
        ? jsonResponse({ code: '42501', message: 'separation of duties: approver cannot approve own invoice (self-approval)' }, { status: 403 })
        : jsonResponse(null);
    }),
    supabaseRpc('release_sales_invoice_submit_clearance', () => jsonResponse(null)),
    supabaseRpc('update_odoo_sales_invoice_draft', (call) => {
      const body = call.bodyJson as Record<string, unknown>;
      if (world.approvalClearance) return jsonResponse({ code: '55006', message: 'invoice-approval-started' }, { status: 409 });
      world.writes?.push({ table: 'sales_invoices', method: 'RPC', body });
      world.writes?.push({ table: 'sales_invoice_authors', method: 'UPSERT', body: { org_id: body.p_org_id, sales_invoice_id: body.p_si_id, user_id: body.p_actor_id } });
      return jsonResponse(null);
    }),
    supabaseRpc('read_vault_secret', () => jsonResponse('odoo-test-key')),
    supabaseSelect('external_org_bindings', (call) => bindingTiers.has(param(call, 'external_tier') ?? '')
      ? (world.odooBinding === null ? nullObjectResponse() : objectResponse({
          id: 'b0000000-0000-4000-8000-000000000001', site_url: `https://${ODOO_HOST}`, secret_ref: 'odoo_ref', status: 'active', activated_at: '2026-11-01T00:00:00Z',
          config: { database: 'db1', odoo_company_id: 1, capabilities: world.snapshot === undefined ? REVENUE_SNAPSHOT : world.snapshot, item_map: { 'ITEM-A': '71' }, sale_tax_id: 5 },
          ...world.odooBinding,
        }))
      : nullObjectResponse()),
    supabaseSelect('external_project_bindings', () => world.projectLink ? objectResponse({ external_container_id: world.projectLink }) : nullObjectResponse()),
    supabaseSelect('external_master_records', (call) => param(call, 'kind') === 'tax'
      ? jsonResponse(world.saleTax === 'absent' ? [] : [{ external_id: '5', name: '12% (Non-Luxury Good)', active: true, tombstoned_at: null,
          attrs: { amount: 11, use: 'sale', tax_group: world.saleTax === 'collector' ? 'Collected by VAT Collector' : 'Non-luxury Good Taxes', price_include: false } }])
      : world.account === null ? nullObjectResponse() : objectResponse(world.account ?? { active: true, tombstoned_at: null })),
    owned('companies'), owned('projects'), owned('work_orders'), owned('sales_invoices'), owned('incoming_payments'),
    // an invoice a receipt settles has its Odoo reference unless the world says it has none; a submit's own record is mapped
    supabaseSelect('external_refs', (call) => {
      const id = param(call, 'pmo_record_id');
      const asked = param(call, 'external_tier');
      if (id === CUSTOMER_ID && param(call, 'domain') === 'companies') return objectResponse({ external_record_id: 'Client:41' });
      if (id === DRAFT_ID && world.draftMapped) return objectResponse({ external_record_id: 'account.move:2' });
      const held = id === INVOICE_ID && world.invoiceInOdoo !== false && (asked === null || asked === (world.invoiceRefTier ?? 'odoo'));
      return held ? objectResponse({ external_record_id: 'account.move:301' }) : nullObjectResponse();
    }),
    { label: 'outbox read', method: 'GET', pathname: '/rest/v1/external_command_outbox', response: (call) => {
      // a list read (the draft's "has an approval started?") answers an array; the command's own row is a single object
      if (!call.url.searchParams.has('idempotency_key')) return jsonResponse([...outbox.values()].filter((r) => r.pmo_record_id === param(call, 'pmo_record_id')));
      const row = outbox.get(`${param(call, 'pmo_record_id')}|${param(call, 'idempotency_key')}`);
      return row ? objectResponse(row) : nullObjectResponse();
    } },
    { label: 'outbox insert', method: 'POST', pathname: '/rest/v1/external_command_outbox', response: (call) => {
      const body = call.bodyJson as Record<string, unknown>;
      const row = { id: `outbox-${outbox.size + 1}`, domain: body.domain, pmo_record_id: body.pmo_record_id, idempotency_key: body.idempotency_key, state: 'pending',
        external_record_id: null, canonical: null, claim_generation: 0, payload_digest: body.payload_digest ?? null, payload: body.payload ?? null };
      outbox.set(`${String(body.pmo_record_id)}|${String(body.idempotency_key)}`, row);
      return objectResponse(row);
    } },
    { label: 'outbox update', method: 'PATCH', pathname: '/rest/v1/external_command_outbox', response: (call) => {
      const id = param(call, 'id');
      const row = [...outbox.values()].find((candidate) => candidate.id === id);
      if (row) Object.assign(row, call.bodyJson as Record<string, unknown>);
      return jsonResponse(row ? [{ id }] : []);
    } },
    supabaseRpc('claim_outbox_for_commit', (call) => {
      const id = (call.bodyJson as { p_id?: string }).p_id;
      const row = [...outbox.values()].find((candidate) => candidate.id === id);
      if (!row) return jsonResponse(null);
      row.claim_generation = Number(row.claim_generation ?? 0) + 1;
      return jsonResponse({ ...row, state: 'committing' });
    }),
    supabaseRpc('mark_outbox_held', (call) => {
      const { p_id, p_generation } = call.bodyJson as { p_id?: string; p_generation?: number };
      const row = [...outbox.values()].find((candidate) => candidate.id === p_id);
      if (!row || row.claim_generation !== p_generation) return jsonResponse(0);
      row.state = 'held';
      return jsonResponse(1);
    }),
    supabaseRpc('record_outbox_ref', () => jsonResponse(1)),
    supabaseRpc('confirm_outbox', () => jsonResponse(1)),
    supabaseRpc('surface_action_required', () => jsonResponse(null)),
    { label: 'external ref write', method: 'POST', pathname: '/rest/v1/external_refs', response: () => jsonResponse([]) },
    // the draft tables: every write is recorded for the test to read
    { label: 'draft write', pathname: '/rest/v1/sales_invoices', method: 'POST', response: (call) => { world.writes?.push({ table: 'sales_invoices', method: 'POST', body: call.bodyJson }); return jsonResponse([]); } },
    { label: 'draft update', pathname: '/rest/v1/sales_invoices', method: 'PATCH', response: (call) => { world.writes?.push({ table: 'sales_invoices', method: 'PATCH', body: call.bodyJson }); return jsonResponse([]); } },
    { label: 'authors', pathname: '/rest/v1/sales_invoice_authors', response: (call) => { world.writes?.push({ table: 'sales_invoice_authors', method: call.method, body: call.bodyJson }); return jsonResponse([]); } },
    { label: 'notifications', pathname: '/rest/v1/notifications', response: () => jsonResponse([]) },
    // the fake Odoo behind the Odoo host: the shipped adapter talks to it over fetch
    ...(world.odoo ? [{ label: 'odoo', host: ODOO_HOST, response: async (call: FetchCall) => {
      const [model, method] = call.url.pathname.split('/').slice(-2);
      return world.odoo!.fetch(`https://${ODOO_HOST}/json/2/${model}/${method}`, { method: 'POST', headers: { Authorization: String(call.headers.get('authorization')) }, body: JSON.stringify(call.bodyJson ?? {}) });
    } } as MockRoute] : []),
    { label: 'unexpected', response: (call) => { unexpected.push(call); return jsonResponse({ message: 'unmocked' }, { status: 404 }); } },
  ];
}

/** A fake Odoo with the client, the products and the two taxes (the chosen 11% and a hidden 10% product default) an invoice approval reads and writes. */
export function invoiceOdooWorld() {
  const fake = createFakeOdoo({ key: 'odoo-test-key' });
  fake.seed('res.company', [{ id: 1, name: 'Co', currency_id: [12, 'IDR'] }]);
  fake.seed('res.partner', [{ id: 41, name: 'Client' }]);
  fake.seed('account.tax', [{ id: 5, name: '12% (Non-Luxury Good)', amount: 11, company_id: [1, 'Co'] }, { id: 9, name: 'Hidden default 10%', amount: 10, company_id: [1, 'Co'] }]);
  fake.seed('product.product', [{ id: 71, name: 'Item A', taxes_id: [9], income_account_id: 149, property_account_income_id: [149, 'Sales'] }]);
  return fake;
}
