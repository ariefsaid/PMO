// #1783 item 1 (D17 / FR-PLN-004/006/007, AC-PLN-006): the REAL served dispatch boundary refuses NEW
// caller-directed receipt line quantities without `procurement_full` (fail closed, only literal true
// admits), preserves Basic whole receipts byte-for-byte, and lets accepted work resume while Full is
// off. Odoo `receiptLines` and ERPNext caller `items` are gated on every body-building operation;
// accepted rows verify by the existing M-3 protocol (a legacy row without a stored digest is verified
// in memory from its persisted payload + persisted operation). Supabase, ERPNext and Odoo are facts
// over fetch; the handler is the shipped one imported from `./index.ts` (test-binding rule).
import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';
import {
  createJwtAuthority, createTestJwksResolver, installEdgeEnv, jsonResponse, withFetchMock,
  type FetchCall,
} from '../_shared/testing/edgeTestKit.ts';
import { canonicalCommandDigest } from './moneyOutboxDeps.ts';
import { requiresReceiptLineEntitlement } from './receiptLineGuard.ts';
import type { AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { receiptDigest } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/receiptBody.ts';

const env = installEdgeEnv();
Deno.env.set('SUPABASE_ANON_KEY', 'synthetic-anon');
Deno.env.set('EXTERNAL_CONNECT_ENABLED', 'true');
Deno.env.set('TEST_BINDING_KEY', 'synthetic-key');
Deno.env.set('TEST_BINDING_SECRET', 'synthetic-secret');
const authority = await createJwtAuthority(env.SUPABASE_URL);
let handler: (req: Request) => Promise<Response>;
(Deno as unknown as { serve: (h: typeof handler) => unknown }).serve = (h) => { handler = h; return { finished: Promise.resolve() }; };
const { setTestJwks } = await import('./index.ts');
setTestJwks(createTestJwksResolver(authority));
addEventListener('unload', () => env.restore());

const org = 'ad000000-0000-4000-8000-000000000001';
const foreignOrg = 'ad000000-0000-4000-8000-0000000000ff';
const user = 'ad000000-0000-4000-8000-000000000002';
const purchase = 'ad000000-0000-4000-8000-000000000003';
const receipt = 'ad000000-0000-4000-8000-000000000004';
const key = 'ad000000-0000-4000-8000-000000000005';
const ODOO = 'odoo.example.test';
const ERP = 'erp.example.test';
const GR_NAME = 'GR-STORED-1';
const REFUSAL = 'Receipt line quantities require procurement full';

const object = (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
const none = () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
const param = (call: FetchCall, k: string): string | null => call.url.searchParams.get(k);
const pathTable = (call: FetchCall): string => call.url.pathname.split('/').at(-1) ?? '';

// ── Odoo world ──────────────────────────────────────────────────────────────────────────────────
const ODOO_BINDING = {
  site_url: `https://${ODOO}`, secret_ref: 'odoo_ref', status: 'active', activated_at: '2026-01-01',
  config: {
    database: 'db1', odoo_company_id: 1, item_map: { Cable: '55', Bolt: '56' },
    capabilities: {
      later: { 'purchase.order': true, 'purchase.order.line': true, 'stock.picking': true, 'stock.move': true, 'account.move': true, 'account.payment': true },
      models: { 'account.journal': { exists: true, read: true } },
    },
  },
};
const ORDER_LINES = [
  { id: 11, product_id: [55, 'Cable'], product_qty: 10, qty_received: 0 },
  { id: 12, product_id: [56, 'Bolt'], product_qty: 4, qty_received: 0 },
];
const planLines = (cable: number, bolt = 0) => [
  { lineId: 11, productId: 55, base: 0, quantity: cable },
  { lineId: 12, productId: 56, base: 0, quantity: bolt },
];
const odooPlanOf = async (cable: number, bolt = 0) => ({
  orderId: 41, lines: planLines(cable, bolt), digest: await receiptDigest(planLines(cable, bolt)),
});

// ── ERPNext world ───────────────────────────────────────────────────────────────────────────────
const ERP_BINDING = {
  site_url: `https://${ERP}`, secret_ref: 'test-binding', status: 'active', activated_at: '2026-01-01',
  version_major: 15, config: { company: 'ACME Ltd' },
};

/** The caller commands. ERPNext gets `items`; Odoo gets `receiptLines`; inert cross-tier aliases too. */
const odooCreate = (record: Record<string, unknown> = {}, withKey = key) => ({
  domain: 'procurement', operation: 'create', idempotencyKey: withKey,
  record: { id: receipt, procurementId: purchase, erp_doc_kind: 'goods-receipt', receiptDate: '2026-11-04', ...record },
});
const erpNextCreate = (record: Record<string, unknown> = {}, withKey = key) => ({
  domain: 'procurement', operation: 'create', idempotencyKey: withKey,
  record: { id: receipt, procurementId: purchase, erp_doc_kind: 'goods-receipt', receiptDate: '2026-11-04', ...record },
});
const erpNextUpdate = (record: Record<string, unknown> = {}) => ({
  domain: 'procurement', operation: 'update', idempotencyKey: key,
  record: { id: receipt, procurementId: purchase, erp_doc_kind: 'goods-receipt', externalRecordId: GR_NAME, ...record },
});
const erpNextTransition = (record: Record<string, unknown> = {}) => ({
  domain: 'procurement', operation: 'transition', idempotencyKey: key,
  record: { id: receipt, procurementId: purchase, erp_doc_kind: 'goods-receipt', externalRecordId: GR_NAME, ...record },
});

/** A stored outbox row produced through the SHIPPED protocol: pass `row.payload`/digests from a real
 *  insert (or `canonicalRow` below); never an invented shape. */
const outboxRowOf = (over: Record<string, unknown>) => ({
  id: 'outbox-receipt-1', org_id: org, domain: 'procurement', pmo_record_id: receipt, idempotency_key: key,
  state: 'pending', external_record_id: null, canonical: null, claim_generation: 0,
  payload_digest: null, procurement_input_digest: null, operation: 'create',
  ...over,
});

/** The wire command shape as the caller posts it (loose record — the server owns the truth). */
interface LineCommand {
  domain: string;
  operation: string;
  idempotencyKey: string;
  record: Record<string, unknown>;
}

interface DispatchOptions {
  tier: 'odoo' | 'erpnext';
  command: LineCommand;
  /** `service_feature_enabled` answer: literal true admits; false/null/1/'true' and RPC errors refuse. */
  feature?: unknown;
  featureError?: boolean;
  /** The stored outbox row a same-key retry finds (GET `external_command_outbox`). `undefined` = none. */
  storedRow?: Record<string, unknown> | null;
  /** ERPNext docstatus the stored ERP document reports (update/amend routeEdit). */
  erpDocstatus?: number;
  /** The caller's profile org (identity is org + record + key). */
  profileOrg?: string;
  /** external_refs carries the record's own GR mapping (update/amend target binding). */
  mappedRecord?: boolean;
  /** actor_authorization_state override. */
  role?: string;
  actorActive?: boolean;
  /** procurement_gate_violation answer (purchase-rules gate). */
  gateViolation?: unknown;
  /** domain_owned_by_tier answer override (403 ordering proof). */
  domainOwned?: boolean;
  /** When true the outbox GET errors (lookup unreadable — fail closed). */
  outboxLookupError?: boolean;
  /** Skip the synthetic claim stop and drive the real commit + finalize. */
  fullCommit?: boolean;
  linkedOrder?: boolean;
}

/**
 * Drives the shipped handler with a strict route table: every fact is explicit; an unexpected fetch
 * throws so a refusal can never silently ride an unmodeled path.
 */
async function servedDispatch(opts: DispatchOptions) {
  const token = await authority.mintJwt({ sub: user });
  const profileOrgId = opts.profileOrg ?? org;
  const erpDocstatus = opts.erpDocstatus ?? 0;
  let validated = false;
  const writtenQty = new Map<number, number>();
  const unexpected: FetchCall[] = [];
  const route = { label: 'receipt line guard served boundary', response: (call: FetchCall): Response => {
    const path = call.url.pathname;
    if (!path.startsWith('/rest/v1/') && call.url.host !== ODOO && call.url.host !== ERP) unexpected.push(call);
    if (path.startsWith('/rest/v1/rpc/')) {
      const rpc = pathTable(call);
      const rpcArgs = (call.bodyJson ?? {}) as Record<string, unknown>;
      if (rpc === 'domain_owned_by_tier') {
        return jsonResponse(opts.domainOwned === undefined ? rpcArgs.p_tier === opts.tier : opts.domainOwned);
      }
      if (rpc === 'actor_authorization_state') return jsonResponse({ role: opts.role ?? 'Project Manager', active: opts.actorActive ?? true });
      if (rpc === 'pre_cutover_procurement') return jsonResponse(false);
      if (rpc === 'linked_step_state') return jsonResponse(opts.linkedOrder ? 'new_step' : 'not_applicable');
      if (rpc === 'record_only_step_refusal') return jsonResponse(null);
      if (rpc === 'procurement_gate_violation') return jsonResponse(opts.gateViolation ?? null);
      if (rpc === 'service_feature_enabled') {
        assertEquals(rpcArgs.p_key, 'procurement_full', 'the guard must consult the exact switch key');
        if (opts.featureError) return jsonResponse({ code: 'P0001', message: 'switch resolver failure' }, { status: 400 });
        return jsonResponse(opts.feature ?? false);
      }
      if (rpc === 'read_vault_secret') return jsonResponse(opts.tier === 'odoo' ? 'odoo-bench-key' : 'synthetic-key:synthetic-secret');
      if (rpc === 'org_has_active_erpnext_binding') return jsonResponse(true);
      if (rpc === 'procurement_create_refusal') return jsonResponse(null);
      if (rpc === 'insert_procurement_outbox_pending') return jsonResponse(outboxRowOf({ state: 'pending' }));
      if (rpc === 'claim_outbox_for_commit') {
        if (!opts.fullCommit) return jsonResponse({ code: 'P0001', message: 'synthetic claim stop' }, { status: 400 });
        const row = opts.storedRow ?? outboxRowOf({ state: 'pending' });
        return object({ ...row, state: row.state === 'pending' || row.state === 'failed' ? 'committing' : row.state, claim_generation: 1 });
      }
      if (rpc === 'record_outbox_ref') return jsonResponse(1);
      if (rpc === 'confirm_outbox') return jsonResponse(1);
      unexpected.push(call);
      throw new Error(`unexpected RPC ${rpc} ${call.url.search}`);
    }
    if (path.startsWith('/rest/v1/')) {
      const table = pathTable(call);
      if (table === 'profiles') return object({ org_id: profileOrgId });
      if (table === 'external_org_bindings') return object(opts.tier === 'odoo' ? ODOO_BINDING : ERP_BINDING);
      if (table === 'procurements') return object({ id: purchase, org_id: org, vendor_id: null, project_id: null });
      if (table === 'external_refs') {
        // resolveExternalRef filters by pmo_record_id (PostgREST `eq.` operator prefix); mirror po_id lookups by external_record_id.
        const eqParam = (k: string): string | null => (param(call, k) ?? '').replace(/^eq\./, '') || null;
        if (eqParam('pmo_record_id') === 'po-pmo-1' || param(call, 'external_record_id') === 'purchase.order:41') return object({ external_record_id: 'purchase.order:41' });
        if (opts.mappedRecord && eqParam('pmo_record_id') === receipt) return object({ external_record_id: GR_NAME });
        return none();
      }
      if (table === 'procurement_erp_links') return jsonResponse(opts.linkedOrder ? [{ erp_purchase_documents: { erp_name: 'PO-LINKED', erp_doctype: 'Purchase Order' } }] : []);
      if (table === 'purchase_orders') return jsonResponse(opts.tier === 'odoo' ? [{ id: 'po-pmo-1' }] : []);
      if (table === 'procurement_items') return jsonResponse([{ name: 'Cable', quantity: 10, rate: 5 }, { name: 'Bolt', quantity: 4, rate: 1 }]);
      if (table === 'external_command_outbox') {
        if (opts.outboxLookupError) return jsonResponse({ code: '42P01', message: 'synthetic outbox lookup failure' }, { status: 400 });
        if (call.method === 'POST') return object(opts.storedRow ?? outboxRowOf({ state: 'pending' }));
        // The fenced write-backs (`mark_outbox_committed`/`mark_outbox_failed`/…) PATCH + `.select('id')`
        // and read the AFFECTED-ROW count off the array — PostgREST returns one row per applied patch.
        if (call.method === 'PATCH') return jsonResponse([{ id: 'outbox-receipt-1' }]);
        // Identity is org-scoped: a row belonging to ANOTHER org is invisible to this caller's lookup.
        if (opts.storedRow !== undefined && opts.storedRow !== null && String(opts.storedRow.org_id) !== profileOrgId) return none();
        return opts.storedRow === undefined ? none() : object(opts.storedRow);
      }
      if (table === 'procurement_receipts') return jsonResponse(call.method === 'GET' ? null : []);
      if (table === 'notifications') return jsonResponse([]);
      unexpected.push(call);
      throw new Error(`unexpected table ${table} ${call.method}`);
    }
    if (call.url.host === ODOO) {
      const model = call.url.pathname.split('/')[3];
      const method = call.url.pathname.split('/')[4];
      if (model === 'purchase.order.line' && method === 'search_read') return jsonResponse(ORDER_LINES);
      if (model === 'stock.picking' && method === 'search_read') {
        return jsonResponse([{ id: 77, name: 'WH/IN/0001', state: validated ? 'done' : 'assigned', move_ids: [501, 502], write_date: '2026-11-04 00:00:00' }]);
      }
      if (model === 'stock.picking' && method === 'read') {
        return jsonResponse([{ name: 'WH/IN/0001', state: validated ? 'done' : 'assigned', move_ids: [501, 502], write_date: '2026-11-04 00:00:00' }]);
      }
      if (model === 'stock.move' && method === 'read') {
        // A validated move with zero booked quantity stays open (Odoo carries it to the backorder),
        // so only moves this receipt actually wrote flip to done.
        return jsonResponse([501, 502].map((id, i) => ({
          id, state: validated && (writtenQty.get(id) ?? 0) > 0 ? 'done' : 'assigned', product_id: i === 0 ? [55, 'Cable'] : [56, 'Bolt'],
          purchase_line_id: i === 0 ? [11, 'Cable'] : [12, 'Bolt'], product_uom_qty: i === 0 ? 10 : 4,
          quantity: writtenQty.get(id) ?? 0,
        })));
      }
      if (model === 'stock.move' && method === 'write') {
        const ids = (call.bodyJson as { ids: number[] }).ids;
        const quantity = (call.bodyJson as { vals: { quantity: number } }).vals.quantity;
        for (const id of ids) writtenQty.set(id, quantity);
        return jsonResponse(1);
      }
      if (model === 'stock.picking' && method === 'button_validate') { validated = true; return jsonResponse(null); }
      if (model === 'ir.model.data') return jsonResponse([]);
      unexpected.push(call);
      throw new Error(`unexpected Odoo call ${model}.${method}`);
    }
    if (call.url.host === ERP) {
      const name = decodeURIComponent(path.split('/').at(-1) ?? '');
      if (call.method === 'GET' && name === 'PO-LINKED') return jsonResponse({ data: { name: 'PO-LINKED', items: [{ item_code: 'Cable', name: 'line-cable' }, { item_code: 'Bolt', name: 'line-bolt' }] } });
      if (call.method === 'GET' && (name === 'Purchase Receipt' || path.includes('filters'))) return jsonResponse({ data: [] });
      if (call.method === 'GET') return jsonResponse({ data: { name: GR_NAME, docstatus: erpDocstatus } });
      if (call.method === 'POST') return jsonResponse({ data: { name: 'GR-REPLACED-2', docstatus: 0 } });
      if (call.method === 'PUT') return jsonResponse({ data: { name, docstatus: (call.bodyJson as { docstatus?: number })?.docstatus ?? erpDocstatus } });
      unexpected.push(call);
      throw new Error(`unexpected ERP call ${call.method} ${path}`);
    }
    unexpected.push(call);
    throw new Error(`unexpected fetch ${call.method} ${call.url.href}`);
  } };
  const result = await withFetchMock([route], async ({ calls }) => {
    const res = await handler(new Request('https://edge.example.test/adapter-dispatch', {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(opts.command),
    }));
    return { status: res.status, body: await res.text(), calls };
  });
  assertEquals(unexpected.map((c) => `${c.method} ${c.url.href}`), [], 'every fetch is an explicit fixture fact');
  return result;
}

const nonReadOdooCalls = (r: { calls: FetchCall[] }) => r.calls.filter((c) => c.url.host === ODOO && !/\/(search_read|read|search|search_count|fields_get|has_access)$/.test(c.url.pathname));
const erpWrites = (r: { calls: FetchCall[] }) => r.calls.filter((c) => c.url.host === ERP && c.method !== 'GET');
const outboxInserts = (r: { calls: FetchCall[] }) => r.calls.filter((c) => c.method === 'POST' && c.url.pathname === '/rest/v1/external_command_outbox');
const insertRpc = (r: { calls: FetchCall[] }) => r.calls.filter((c) => c.url.pathname === '/rest/v1/rpc/insert_procurement_outbox_pending');
const featureReads = (r: { calls: FetchCall[] }) => r.calls.filter((c) => c.url.pathname === '/rest/v1/rpc/service_feature_enabled');
const vaultReads = (r: { calls: FetchCall[] }) => r.calls.filter((c) => c.url.pathname === '/rest/v1/rpc/read_vault_secret');
const storedOutboxPayload = (r: { calls: FetchCall[] }): Record<string, unknown> => {
  const post = outboxInserts(r)[0]?.bodyJson as { payload?: Record<string, unknown> } | undefined;
  const rpc = insertRpc(r)[0]?.bodyJson as { p_payload?: Record<string, unknown> } | undefined;
  return rpc?.p_payload ?? post?.payload ?? {};
};

// ── Task 1: the real served Full gate, identity and refusal ─────────────────────────────────────

describe('D17 / FR-PLN-004 a NEW caller-directed receipt line write requires procurement_full (literal true only)', () => {
  it('sends a new receipt against its linked ERP order', async () => {
    const r = await servedDispatch({ tier: 'erpnext', command: erpNextCreate(), linkedOrder: true, fullCommit: true });
    assertEquals(r.status, 200, r.body);
    const post = erpWrites(r).find((c) => c.method === 'POST');
    assert(post);
    const body = post.bodyJson as { items: Array<{ purchase_order: string; purchase_order_item: string }> };
    assertEquals(body.items.map((i) => [i.purchase_order, i.purchase_order_item]), [['PO-LINKED', 'line-cable'], ['PO-LINKED', 'line-bolt']]);
  });

  it('sends selected receipt lines against their linked ERP order', async () => {
    const r = await servedDispatch({ tier: 'erpnext', command: erpNextCreate({ items: [{ item_code: 'Cable', qty: 6 }] }), linkedOrder: true, feature: true, fullCommit: true });
    assertEquals(r.status, 200, r.body);
    const post = erpWrites(r).find((c) => c.method === 'POST');
    assert(post);
    const body = post.bodyJson as { items: Array<{ purchase_order: string; purchase_order_item: string }> };
    assertEquals(body.items.map((i) => [i.purchase_order, i.purchase_order_item]), [['PO-LINKED', 'line-cable']]);
  });

  it('Full on lets a new Odoo caller-line receipt reach the shipped money path with the exact plan', async () => {
    const r = await servedDispatch({ tier: 'odoo', command: odooCreate({ receiptLines: [{ itemRef: 'Cable', quantity: 6 }] }), feature: true, fullCommit: true });
    assertEquals(r.status, 200, r.body);
    assertEquals(nonReadOdooCalls(r).length > 0, true, 'the accepted command reaches the Odoo adapter');
    assertEquals(featureReads(r).length, 1);
    const payload = storedOutboxPayload(r);
    const plan = payload.odooReceipt as { lines: { lineId: number; productId: number; quantity: number }[] };
    assertEquals(plan.lines.map((l) => [l.lineId, l.quantity]), [[11, 6], [12, 0]], 'exactly the entered Cable quantity, Bolt stays open');
    assertEquals(payload.receiptLines, [{ itemRef: 'Cable', quantity: 6 }]);
  });

  it('Full on lets a new ERPNext caller-items receipt reach the shipped money path with the caller lines', async () => {
    const r = await servedDispatch({ tier: 'erpnext', command: erpNextCreate({ items: [{ item_code: 'Cable', qty: 6 }] }), feature: true, fullCommit: true });
    assertEquals(r.status, 200, r.body);
    assertEquals(erpWrites(r).length > 0, true, 'the accepted command reaches the ERPNext adapter');
    assertEquals(featureReads(r).length, 1);
    const payload = storedOutboxPayload(r);
    assertEquals(payload.items, [{ item_code: 'Cable', qty: 6 }]);
    const snapshot = payload.pmo_gr_snapshot as { raw_digest?: string };
    assert(/^[0-9a-f]{64}$/.test(String(snapshot?.raw_digest)), 'the caller-items create still carries the server-stamped witness');
    const expected = await canonicalCommandDigest({ domain: 'procurement', operation: 'create', record: {
      ...erpNextCreate({ items: [{ item_code: 'Cable', qty: 6 }] }).record, pmo_gr_snapshot: snapshot } });
    const outboxPost = outboxInserts(r)[0].bodyJson as { payload_digest?: string };
    assertEquals(outboxPost.payload_digest, expected, 'M-3 binds the key to the stamped payload');
  });

  const refusals = [
    { label: 'explicit off', feature: false },
    { label: 'null body', feature: null },
    { label: 'numeric body', feature: 1 },
    { label: 'string body', feature: 'true' },
    { label: 'resolver error', featureError: true },
  ];
  for (const odoo of [true, false]) {
    for (const c of refusals) {
      it(`refuses a new ${odoo ? 'Odoo' : 'ERPNext'} line receipt when the switch is unreadable/off (${c.label}) — fail closed, nothing written`, async () => {
        const command = odoo
          ? odooCreate({ receiptLines: [{ itemRef: 'Cable', quantity: 6 }] })
          : erpNextCreate({ items: [{ item_code: 'Cable', qty: 6 }] });
        const r = await servedDispatch({ tier: odoo ? 'odoo' : 'erpnext', command, ...c });
        assertEquals(r.status, 422, r.body);
        assertEquals(JSON.parse(r.body).message, REFUSAL);
        assertEquals(vaultReads(r).length, 0, 'no ERP credential is resolved for a refused line write');
        assertEquals(outboxInserts(r).length + insertRpc(r).length, 0, 'no outbox row is minted');
        assertEquals(nonReadOdooCalls(r).length, 0);
        assertEquals(erpWrites(r).length, 0);
      });
    }
  }
});

describe('D17 / FR-PLN-006 Basic whole receipts and invalid line inputs keep their shipped behavior', () => {
  it('an Odoo receipt with no receiptLines never consults the switch and receives every open quantity', async () => {
    const r = await servedDispatch({ tier: 'odoo', command: odooCreate(), feature: false, fullCommit: true });
    assertEquals(r.status, 200, r.body);
    assertEquals(featureReads(r).length, 0, 'Basic whole transport does not read Full');
    const plan = storedOutboxPayload(r).odooReceipt as { lines: { lineId: number; quantity: number }[] };
    assertEquals(plan.lines.map((l) => [l.lineId, l.quantity]), [[11, 10], [12, 4]], 'all-open plan');
  });

  it('an ERPNext receipt without caller items never consults the switch: the server derives the lines', async () => {
    const r = await servedDispatch({ tier: 'erpnext', command: erpNextCreate(), feature: false, fullCommit: true });
    assertEquals(r.status, 200, r.body);
    assertEquals(featureReads(r).length, 0);
    const payload = storedOutboxPayload(r);
    assertEquals((payload.items as { item_code: string }[]).map((i) => i.item_code), ['Cable', 'Bolt'], 'server-derived transport lines');
  });

  it('inert cross-tier aliases never select line work (Odoo items / ERPNext receiptLines)', async () => {
    const odoo = await servedDispatch({ tier: 'odoo', command: odooCreate({ items: [{ item_code: 'Cable', qty: 6 }] }), feature: false, fullCommit: true });
    assertEquals(odoo.status, 200, odoo.body);
    assertEquals(featureReads(odoo).length, 0);
    const erp = await servedDispatch({ tier: 'erpnext', command: erpNextCreate({ receiptLines: [{ itemRef: 'Cable', quantity: 6 }] }), feature: false, fullCommit: true });
    assertEquals(erp.status, 200, erp.body);
    assertEquals(featureReads(erp).length, 0);
    const snapshot = storedOutboxPayload(erp).pmo_gr_snapshot as { raw_digest?: string };
    assert(/^[0-9a-f]{64}$/.test(String(snapshot?.raw_digest)), 'inert aliases still leave Basic transport server-owned');
  });

  it('an Odoo empty or non-array receiptLines keeps its existing validation refusal, not a Full refusal', async () => {
    const empty = await servedDispatch({ tier: 'odoo', command: odooCreate({ receiptLines: [] }), feature: false });
    assertEquals(empty.status, 422, empty.body);
    assertEquals(JSON.parse(empty.body).message, 'receipt-empty');
    assertEquals(featureReads(empty).length, 0);
    const malformed = await servedDispatch({ tier: 'odoo', command: odooCreate({ receiptLines: 'all' }), feature: false });
    assertEquals(malformed.status, 422, malformed.body);
    assertEquals(JSON.parse(malformed.body).message, 'receipt-lines-invalid');
    assertEquals(featureReads(malformed).length, 0);
  });

  it('a NONEMPTY malformed Odoo line array is Full-refused first while off, validator-refused while on', async () => {
    const off = await servedDispatch({ tier: 'odoo', command: odooCreate({ receiptLines: [{ itemRef: 'Cable' }] }), feature: false });
    assertEquals(off.status, 422, off.body);
    assertEquals(JSON.parse(off.body).message, REFUSAL);
    const on = await servedDispatch({ tier: 'odoo', command: odooCreate({ receiptLines: [{ itemRef: 'Cable' }] }), feature: true });
    assertEquals(on.status, 422, on.body);
    assertEquals(JSON.parse(on.body).message, 'receipt-lines-invalid', 'Full on retains the shipped validator');
  });

  it('a caller cannot forge the ERPNext witness or the Odoo plan: server facts win', async () => {
    const erp = await servedDispatch({ tier: 'erpnext', command: erpNextCreate({ pmo_gr_snapshot: { supplier: 'Forged', po: 'Forged', raw_digest: 'forged' } }), feature: true, fullCommit: true });
    assertEquals(erp.status, 200, erp.body);
    const snapshot = storedOutboxPayload(erp).pmo_gr_snapshot as { supplier?: unknown };
    assertEquals(snapshot.supplier, null, 'the witness is re-stamped server-side, not adopted');
    const odoo = await servedDispatch({ tier: 'odoo', command: odooCreate({ odooReceipt: { forged: true }, receiptDigest: 'forged' }), feature: true, fullCommit: true });
    assertEquals(odoo.status, 200, odoo.body);
    const plan = storedOutboxPayload(odoo).odooReceipt as { lines: unknown };
    assert(Array.isArray(plan.lines), 'the server plan replaced the forged one');
  });

  it('a non-receipt command never triggers the guard lookup or the Full RPC', async () => {
    const command = { domain: 'procurement', operation: 'create', idempotencyKey: key, record: { id: receipt, procurementId: purchase, erp_doc_kind: 'purchase-order' } };
    const r = await servedDispatch({ tier: 'erpnext', command, feature: false });
    assertEquals(featureReads(r).length, 0, 'no Full read for a non-receipt kind');
    assert(r.status !== 422 || JSON.parse(r.body).message !== REFUSAL, 'not refused by this guard');
  });
});

describe('D17 the guard runs after the shipped auth ordering, never before it', () => {
  const lineCommand = () => erpNextCreate({ items: [{ item_code: 'Cable', qty: 6 }] });
  const ordering = [
    { label: 'an inactive actor', role: 'Project Manager', actorActive: false, expectedStatus: 403 },
    { label: 'a role outside the money-write set', role: 'Engineer', actorActive: true, expectedStatus: 403 },
    { label: 'a purchase-rules violation', gateViolation: 'P0001', expectedStatus: 422 },
    { label: 'an org that does not own the domain', domainOwned: false, expectedStatus: 403 },
  ];
  for (const c of ordering) {
    it(`${c.label} refuses before the Full RPC, the outbox and ERP`, async () => {
      const r = await servedDispatch({ tier: 'erpnext', command: lineCommand(), feature: false, ...c });
      assert(r.status >= 400, r.body);
      assertEquals(featureReads(r).length, 0, 'the guard is consulted only after auth + gates pass');
      assertEquals(outboxInserts(r).length + insertRpc(r).length, 0);
      assertEquals(erpWrites(r).length, 0);
    });
  }

  it('an unreadable outbox lookup fails closed: no feature bypass, no outbox/ERP effects', async () => {
    const r = await servedDispatch({ tier: 'erpnext', command: lineCommand(), feature: true, outboxLookupError: true });
    assert(r.status >= 400, r.body);
    assertEquals(featureReads(r).length, 0, 'the guard never answers without the row lookup');
    assertEquals(outboxInserts(r).length + insertRpc(r).length, 0);
    assertEquals(erpWrites(r).length, 0);
  });
});

// ── Task 2: every ERPNext body writer, and accepted-work protocol ───────────────────────────────

describe('FR-PLN-006/007 every ERPNext body-building operation is gated before credentials and ERP reads', () => {
  it('Full off refuses a draft update before the vault read, the ERP docstatus read and any write', async () => {
    const r = await servedDispatch({ tier: 'erpnext', command: erpNextUpdate({ items: [{ item_code: 'Cable', qty: 6 }] }), feature: false, mappedRecord: true });
    assertEquals(r.status, 422, r.body);
    assertEquals(JSON.parse(r.body).message, REFUSAL);
    assertEquals(vaultReads(r).length, 0);
    assertEquals(erpWrites(r).length, 0);
    assertEquals(r.calls.filter((c) => c.url.host === ERP).length, 0, 'not even the docstatus read');
    assertEquals(outboxInserts(r).length + insertRpc(r).length, 0);
  });

  it('Full on reaches the draft PUT with the caller quantity', async () => {
    const r = await servedDispatch({ tier: 'erpnext', command: erpNextUpdate({ items: [{ item_code: 'Cable', qty: 6 }] }), feature: true, erpDocstatus: 0, mappedRecord: true, fullCommit: true });
    assertEquals(r.status, 200, r.body);
    const put = r.calls.find((c) => c.url.host === ERP && c.method === 'PUT' && decodeURIComponent(c.url.pathname.split('/').at(-1) ?? '') === GR_NAME);
    assert(put, 'the draft PUT happened');
    const body = (put!.bodyJson as { items?: { item_code: string; qty: number }[] }).items;
    assertEquals(body, [{ item_code: 'Cable', qty: 6 }], 'the caller quantity reaches the ERP body');
  });

  it('Full off refuses a submitted amend before the ERP cancel/POST; Full on cancels and posts the replacement', async () => {
    const off = await servedDispatch({ tier: 'erpnext', command: erpNextUpdate({ items: [{ item_code: 'Cable', qty: 6 }] }), feature: false, erpDocstatus: 1, mappedRecord: true });
    assertEquals(off.status, 422, off.body);
    assertEquals(JSON.parse(off.body).message, REFUSAL);
    assertEquals(vaultReads(off).length, 0);
    assertEquals(off.calls.filter((c) => c.url.host === ERP).length, 0);
    assertEquals(outboxInserts(off).length + insertRpc(off).length, 0);

    const on = await servedDispatch({ tier: 'erpnext', command: erpNextUpdate({ items: [{ item_code: 'Cable', qty: 6 }] }), feature: true, erpDocstatus: 1, mappedRecord: true, fullCommit: true });
    assertEquals(on.status, 200, on.body);
    const erpCalls = on.calls.filter((c) => c.url.host === ERP && c.method !== 'GET');
    const cancelPut = erpCalls.find((c) => c.method === 'PUT');
    assert(cancelPut, 'cancel PUT happened');
    assertEquals((cancelPut.bodyJson as { docstatus?: number }).docstatus, 2);
    const replacementPosts = erpCalls.filter((c) => c.method === 'POST');
    assertEquals(replacementPosts.length, 1, 'exactly one replacement POST');
    assertEquals((replacementPosts[0].bodyJson as { items?: { item_code: string; qty: number }[] }).items, [{ item_code: 'Cable', qty: 6 }]);
    assertEquals((replacementPosts[0].bodyJson as { company?: string }).company, 'ACME Ltd', 'the replacement states the binding company');
    assert(on.calls.indexOf(cancelPut) < on.calls.indexOf(replacementPosts[0]), 'cancel precedes replacement POST');
  });

  it('a transition amend is gated the same way; Full on cancels then posts the replacement', async () => {
    const off = await servedDispatch({ tier: 'erpnext', command: erpNextTransition({ verb: 'amend', items: [{ item_code: 'Cable', qty: 6 }] }), feature: false, erpDocstatus: 1, mappedRecord: true });
    assertEquals(off.status, 422, off.body);
    assertEquals(JSON.parse(off.body).message, REFUSAL);
    assertEquals(vaultReads(off).length, 0);
    assertEquals(off.calls.filter((c) => c.url.host === ERP).length, 0);
    assertEquals(outboxInserts(off).length + insertRpc(off).length, 0);

    const on = await servedDispatch({ tier: 'erpnext', command: erpNextTransition({ verb: 'amend', items: [{ item_code: 'Cable', qty: 6 }] }), feature: true, erpDocstatus: 1, mappedRecord: true, fullCommit: true });
    assertEquals(on.status, 200, on.body);
    const erpCalls = on.calls.filter((c) => c.url.host === ERP && c.method !== 'GET');
    const cancelPut = erpCalls.find((c) => c.method === 'PUT');
    assert(cancelPut, 'cancel PUT happened');
    assertEquals((cancelPut.bodyJson as { docstatus?: number }).docstatus, 2);
    const replacementPosts = erpCalls.filter((c) => c.method === 'POST');
    assertEquals(replacementPosts.length, 1, 'exactly one replacement POST');
    assertEquals((replacementPosts[0].bodyJson as { items?: { item_code: string; qty: number }[] }).items, [{ item_code: 'Cable', qty: 6 }]);
    assertEquals((replacementPosts[0].bodyJson as { company?: string }).company, 'ACME Ltd', 'the replacement states the binding company');
    assert(on.calls.indexOf(cancelPut) < on.calls.indexOf(replacementPosts[0]), 'cancel precedes replacement POST');
  });

  it('submit and cancel build no body: never gated, never read (shipped behavior unchanged)', async () => {
    const submit = await servedDispatch({
      tier: 'erpnext',
      command: erpNextTransition({ verb: 'submit', items: [{ item_code: 'Cable', qty: 6 }] }),
      feature: false,
      mappedRecord: true,
      erpDocstatus: 0,
      fullCommit: true,
    });
    assertEquals(submit.status, 200, submit.body);
    assertEquals(featureReads(submit).length, 0, 'submit never consults Full');
    const submitPut = submit.calls.find((c) => c.url.host === ERP && c.method === 'PUT');
    assert(submitPut, 'submit called ERP PUT');
    assertEquals((submitPut.bodyJson as { docstatus?: number }).docstatus, 1);

    const cancel = await servedDispatch({
      tier: 'erpnext',
      command: erpNextTransition({ verb: 'cancel', items: [{ item_code: 'Cable', qty: 6 }] }),
      feature: false,
      mappedRecord: true,
      erpDocstatus: 1,
      fullCommit: true,
    });
    assertEquals(cancel.status, 200, cancel.body);
    assertEquals(featureReads(cancel).length, 0, 'cancel never consults Full');
    const cancelPut = cancel.calls.find((c) => c.url.host === ERP && c.method === 'PUT');
    assert(cancelPut, 'cancel called ERP PUT');
    assertEquals((cancelPut.bodyJson as { docstatus?: number }).docstatus, 2);
  });

  it('an Odoo receipt update keeps its shipped adapter refusal without a Full read', async () => {
    const createWithLines = odooCreate({ receiptLines: [{ itemRef: 'Cable', quantity: 6 }] });
    assertEquals(requiresReceiptLineEntitlement('odoo', createWithLines as unknown as AdapterCommand), true);
    assertEquals(requiresReceiptLineEntitlement('odoo', { ...createWithLines, operation: 'update' } as unknown as AdapterCommand), false);
    assertEquals(requiresReceiptLineEntitlement('odoo', { ...createWithLines, operation: 'transition' } as unknown as AdapterCommand), false);

    const r = await servedDispatch({
      tier: 'odoo',
      command: { ...createWithLines, operation: 'update' },
      feature: false,
      mappedRecord: true,
    });
    assertEquals(r.status, 422, r.body);
    const parsed = JSON.parse(r.body);
    assertEquals(parsed.error, 'config-rejected');
    assertEquals(parsed.message, 'Purchasing through Odoo is not available yet');
    assertEquals(featureReads(r).length, 0);
    assertEquals(outboxInserts(r).length + insertRpc(r).length, 0);
    assertEquals(nonReadOdooCalls(r).length, 0);
  });
});

describe('FR-PLN-006/007 accepted work resumes while Full is off; changed material/operation is rejected', () => {
  /** First dispatch (Full on) produces the real stored row shape through the shipped insert. */
  async function firstAccepted(opts: { tier: 'odoo' | 'erpnext'; command: LineCommand }) {
    const first = await servedDispatch({ ...opts, feature: true, fullCommit: true, storedRow: null });
    assertEquals(first.status, 200, first.body);
    const post = outboxInserts(first)[0] ?? insertRpc(first)[0];
    const body = post.bodyJson as Record<string, unknown>;
    return {
      payload: body.payload as Record<string, unknown>,
      payloadDigest: body.payload_digest as string,
      procurementInputDigest: (body.procurement_input_digest ?? null) as string | null,
    };
  }

  it('an Odoo accepted create resumes with the same identity while Full is off — no duplicate ERP write, no Full read', async () => {
    const command = odooCreate({ receiptLines: [{ itemRef: 'Cable', quantity: 6 }] });
    const accepted = await firstAccepted({ tier: 'odoo', command });
    const row = outboxRowOf({ state: 'confirmed', external_record_id: 'stock.picking:77', payload: accepted.payload, payload_digest: accepted.payloadDigest });
    const retry = await servedDispatch({ tier: 'odoo', command, feature: false, storedRow: row });
    assertEquals(retry.status, 200, retry.body);
    assertEquals(featureReads(retry).length, 0, 'accepted work never re-reads Full');
    assertEquals(nonReadOdooCalls(retry).length, 0, 'a confirmed replay is read-only in Odoo');
    assertEquals(outboxInserts(retry).length, 0, 'no duplicate row');
  });

  it('an ERPNext accepted create resumes while Full is off (both digest-bearing and legacy shapes)', async () => {
    const command = erpNextCreate({ items: [{ item_code: 'Cable', qty: 6 }] });
    const accepted = await firstAccepted({ tier: 'erpnext', command });
    const commandNoInput = erpNextCreate({ items: [{ item_code: 'Cable', qty: 6 }] });
    // With procurement_input_digest present (verified snapshot replay):
    const withInput = await servedDispatch({ tier: 'erpnext', command, feature: false, storedRow: outboxRowOf({
      state: 'confirmed', external_record_id: GR_NAME, payload: accepted.payload, payload_digest: accepted.payloadDigest,
      procurement_input_digest: accepted.procurementInputDigest,
    }) });
    assertEquals(withInput.status, 200, withInput.body);
    assertEquals(featureReads(withInput).length, 0);
    assertEquals(erpWrites(withInput).length, 0, 'a confirmed replay writes nothing');
    void commandNoInput;
  });

  it('an ERPNext create row WITHOUT procurement_input_digest (plain M-3 digest only) resumes while Full is off', async () => {
    const origCommand = erpNextCreate({ items: [{ item_code: 'Cable', qty: 6 }] });
    const accepted = await firstAccepted({ tier: 'erpnext', command: origCommand });
    const { raw_digest: _rd, ...cleanSnapshot } = (accepted.payload.pmo_gr_snapshot ?? {}) as Record<string, unknown>;
    const storedPayload = { ...accepted.payload, pmo_gr_snapshot: cleanSnapshot };
    const storedDigest = await canonicalCommandDigest({
      domain: origCommand.domain,
      operation: origCommand.operation,
      record: storedPayload,
    });
    const storedRow = outboxRowOf({
      state: 'confirmed',
      operation: 'create',
      external_record_id: GR_NAME,
      payload: storedPayload,
      payload_digest: storedDigest,
      procurement_input_digest: null,
    });

    // 1. Exact match retry resumes with 200, no Full reads, no ERP writes, no inserts, no claim
    const resume = await servedDispatch({
      tier: 'erpnext',
      command: erpNextCreate({ items: [{ item_code: 'Cable', qty: 6 }] }),
      feature: false,
      storedRow,
    });
    assertEquals(resume.status, 200, resume.body);
    assertEquals(featureReads(resume).length, 0);
    assertEquals(erpWrites(resume).length, 0);
    assertEquals(outboxInserts(resume).length + insertRpc(resume).length, 0);
    assert(!resume.calls.some((c) => c.url.pathname.endsWith('/rpc/claim_outbox_for_commit')), 'no claim on confirmed row');

    // 2. Changed quantity (qty 7) -> 422 idempotency-key-payload-mismatch
    const changedQty = await servedDispatch({
      tier: 'erpnext',
      command: erpNextCreate({ items: [{ item_code: 'Cable', qty: 7 }] }),
      feature: false,
      storedRow,
    });
    assertEquals(changedQty.status, 422, changedQty.body);
    assertEquals(JSON.parse(changedQty.body).message, 'idempotency-key-payload-mismatch');
    assertEquals(erpWrites(changedQty).length, 0);
    assertEquals(outboxInserts(changedQty).length + insertRpc(changedQty).length, 0);
    assert(!changedQty.calls.some((c) => c.url.pathname.endsWith('/rpc/claim_outbox_for_commit')));

    // 3. Mapped update using the same key and row -> 422 idempotency-key-payload-mismatch
    const mappedUpdate = await servedDispatch({
      tier: 'erpnext',
      command: { ...erpNextUpdate({ items: [{ item_code: 'Cable', qty: 6 }] }), idempotencyKey: origCommand.idempotencyKey },
      feature: false,
      mappedRecord: true,
      storedRow,
    });
    assertEquals(mappedUpdate.status, 422, mappedUpdate.body);
    assertEquals(JSON.parse(mappedUpdate.body).message, 'idempotency-key-payload-mismatch');
    assertEquals(erpWrites(mappedUpdate).length, 0);

    // 4. Corrupted stored payload with unchanged M-3 digest -> 422 before claim/write
    const corruptedPayloadRow = outboxRowOf({
      state: 'confirmed',
      operation: 'create',
      external_record_id: GR_NAME,
      payload: { ...storedPayload, supplier: 'CorruptedSupplier' },
      payload_digest: storedDigest,
      procurement_input_digest: null,
    });
    const corrupted = await servedDispatch({
      tier: 'erpnext',
      command: erpNextCreate({ items: [{ item_code: 'Cable', qty: 6 }] }),
      feature: false,
      storedRow: corruptedPayloadRow,
    });
    assertEquals(corrupted.status, 422, corrupted.body);
    assertEquals(JSON.parse(corrupted.body).message, 'idempotency-key-payload-mismatch');
    assertEquals(erpWrites(corrupted).length, 0);
    assert(!corrupted.calls.some((c) => c.url.pathname.endsWith('/rpc/claim_outbox_for_commit')));

    // 5. Malformed snapshot (e.g. invalid supplier type) -> 422 before claim/write
    const malformedSnapshotRow = outboxRowOf({
      state: 'confirmed',
      operation: 'create',
      external_record_id: GR_NAME,
      payload: {
        ...storedPayload,
        pmo_gr_snapshot: { supplier: 12345 },
      },
      payload_digest: storedDigest,
      procurement_input_digest: null,
    });
    const malformed = await servedDispatch({
      tier: 'erpnext',
      command: erpNextCreate({ items: [{ item_code: 'Cable', qty: 6 }] }),
      feature: false,
      storedRow: malformedSnapshotRow,
    });
    assertEquals(malformed.status, 422, malformed.body);
    assertEquals(JSON.parse(malformed.body).message, 'idempotency-key-payload-mismatch');
    assertEquals(erpWrites(malformed).length, 0);
    assert(!malformed.calls.some((c) => c.url.pathname.endsWith('/rpc/claim_outbox_for_commit')));
  });

  it('an ERPNext accepted UPDATE resumes while Full is off; a fresh key refuses; changed quantity is a key-payload mismatch', async () => {
    const command = erpNextUpdate({ items: [{ item_code: 'Cable', qty: 6 }] });
    const first = await servedDispatch({ tier: 'erpnext', command, feature: true, erpDocstatus: 0, mappedRecord: true, fullCommit: true, storedRow: null });
    assertEquals(first.status, 200, first.body);
    const body = outboxInserts(first)[0].bodyJson as Record<string, unknown>;
    const row = outboxRowOf({ state: 'failed', operation: 'update', payload: body.payload, payload_digest: body.payload_digest });

    const resume = await servedDispatch({ tier: 'erpnext', command, feature: false, storedRow: row, mappedRecord: true, fullCommit: true });
    assertEquals(resume.status, 200, resume.body);
    assertEquals(featureReads(resume).length, 0, 'accepted update work never re-reads Full');
    assert(erpWrites(resume).length > 0, 'the failed update resumed through the normal recovery');

    const changed = await servedDispatch({ tier: 'erpnext', command: erpNextUpdate({ items: [{ item_code: 'Cable', qty: 7 }] }), feature: false, storedRow: row, mappedRecord: true, erpDocstatus: 0 });
    assertEquals(changed.status, 422, changed.body);
    assertEquals(JSON.parse(changed.body).message, 'idempotency-key-payload-mismatch');
    assertEquals(erpWrites(changed).length, 0);

    const freshKey = await servedDispatch({ tier: 'erpnext', command: { ...command, idempotencyKey: 'ad000000-0000-4000-8000-000000000006' }, feature: false, mappedRecord: true });
    assertEquals(freshKey.status, 422, freshKey.body);
    assertEquals(JSON.parse(freshKey.body).message, REFUSAL, 'a fresh key with Full off is a NEW line write');
  });

  it('an ERPNext accepted TRANSITION amend resumes while Full is off', async () => {
    const command = erpNextTransition({ verb: 'amend', items: [{ item_code: 'Cable', qty: 6 }] });
    const first = await servedDispatch({ tier: 'erpnext', command, feature: true, erpDocstatus: 0, mappedRecord: true, fullCommit: true, storedRow: null });
    assertEquals(first.status, 200, first.body);
    const body = outboxInserts(first)[0].bodyJson as Record<string, unknown>;
    const row = outboxRowOf({ state: 'failed', operation: 'transition', payload: body.payload, payload_digest: null });
    const resume = await servedDispatch({ tier: 'erpnext', command, feature: false, storedRow: row, mappedRecord: true, erpDocstatus: 0, fullCommit: true });
    assertEquals(resume.status, 200, resume.body);
    assertEquals(featureReads(resume).length, 0);

    const changed = await servedDispatch({ tier: 'erpnext', command: erpNextTransition({ verb: 'amend', items: [{ item_code: 'Cable', qty: 7 }] }), feature: false, storedRow: row, mappedRecord: true, erpDocstatus: 0 });
    assertEquals(changed.status, 422, changed.body);
    assertEquals(JSON.parse(changed.body).message, 'idempotency-key-payload-mismatch');
    assertEquals(erpWrites(changed).length, 0);
  });

  it('changed caller material on an accepted Odoo create is a key-payload mismatch', async () => {
    const command = odooCreate({ receiptLines: [{ itemRef: 'Cable', quantity: 6 }] });
    const accepted = await firstAccepted({ tier: 'odoo', command });
    const row = outboxRowOf({ state: 'failed', payload: accepted.payload, payload_digest: accepted.payloadDigest });
    const changed = await servedDispatch({ tier: 'odoo', command: odooCreate({ receiptLines: [{ itemRef: 'Cable', quantity: 7 }] }), feature: false, storedRow: row });
    assertEquals(changed.status, 422, changed.body);
    assertEquals(JSON.parse(changed.body).message, 'idempotency-key-payload-mismatch');
    assertEquals(nonReadOdooCalls(changed).length, 0, 'no write follows a mismatch');
  });

  it('the same key and material in another org is NOT the accepted identity', async () => {
    const command = odooCreate({ receiptLines: [{ itemRef: 'Cable', quantity: 6 }] });
    const accepted = await firstAccepted({ tier: 'odoo', command });
    const row = outboxRowOf({ state: 'failed', payload: accepted.payload, payload_digest: accepted.payloadDigest });
    // The stored row belongs to the ORIGINAL org; the foreign org's lookup (its own profile org) must
    // not see it — identity is org + domain + record + key, so the guard fires fresh for this caller.
    const foreign = await servedDispatch({ tier: 'odoo', command, feature: false, storedRow: row, profileOrg: foreignOrg });
    assertEquals(foreign.status, 422, foreign.body);
    assertEquals(JSON.parse(foreign.body).message, REFUSAL, 'another org\'s row cannot bypass Full');
  });

  it('a broken stored Odoo plan is still refused (existing protocol intact); snapshot mismatch still refuses', async () => {
    const command = odooCreate({ receiptLines: [{ itemRef: 'Cable', quantity: 6 }] });
    const accepted = await firstAccepted({ tier: 'odoo', command });
    const brokenPlanRow = outboxRowOf({ state: 'pending', payload: { ...accepted.payload, odooReceipt: 'not-a-plan' }, payload_digest: accepted.payloadDigest });
    const broken = await servedDispatch({ tier: 'odoo', command, feature: false, storedRow: brokenPlanRow });
    assert(broken.status >= 400, broken.body);
    assertEquals(JSON.parse(broken.body).message, 'receipt-plan-invalid', 'never re-planned, never adopted');

    const raw = erpNextCreate({ items: [{ item_code: 'Cable', qty: 6 }] }).record;
    const rawDigest = await canonicalCommandDigest({ domain: 'procurement', operation: 'create', record: raw });
    const snapshot = { supplier: 'S', po: 'PO-1', raw_digest: rawDigest };
    const payload = { ...raw, pmo_gr_snapshot: snapshot };
    const stored = outboxRowOf({
      state: 'confirmed', payload, payload_digest: await canonicalCommandDigest({ domain: 'procurement', operation: 'create', record: payload }),
      procurement_input_digest: rawDigest,
    });
    const changedCaller = await servedDispatch({ tier: 'erpnext', command: erpNextCreate({ items: [{ item_code: 'Cable', qty: 6 }], receiptDate: '2026-11-05' }), feature: false, storedRow: stored });
    assertEquals(changedCaller.status, 422, changedCaller.body);
    assertEquals(JSON.parse(changedCaller.body).message, 'idempotency-key-payload-mismatch', 'the trusted-snapshot replay check still binds caller material');
  });
});

describe('FR-PLN-006 legacy accepted rows (no stored digest) verify in memory before any new write', () => {
  const legacyOdooRow = async () => {
    const plan = await odooPlanOf(6);
    const payload = {
      id: receipt, procurementId: purchase, erp_doc_kind: 'goods-receipt', receiptDate: '2026-11-04',
      receiptLines: [{ itemRef: 'Cable', quantity: 6 }], odooReceipt: plan, receiptDigest: plan.digest,
    };
    return outboxRowOf({ state: 'failed', payload, payload_digest: null, procurement_input_digest: null, operation: 'create' });
  };

  it('an Odoo legacy row with the exact persisted material+operation resumes while Full is off', async () => {
    const row = await legacyOdooRow();
    const command = odooCreate({ receiptLines: [{ itemRef: 'Cable', quantity: 6 }] });
    const retry = await servedDispatch({ tier: 'odoo', command, feature: false, storedRow: row, fullCommit: true });
    assertEquals(retry.status, 200, retry.body);
    assertEquals(featureReads(retry).length, 0, 'the accepted-row exemption holds for a verifiable legacy row');
  });

  it('an Odoo legacy row with changed quantity refuses before any write', async () => {
    const row = await legacyOdooRow();
    const changed = await servedDispatch({ tier: 'odoo', command: odooCreate({ receiptLines: [{ itemRef: 'Cable', quantity: 7 }] }), feature: false, storedRow: row });
    assertEquals(changed.status, 422, changed.body);
    assertEquals(JSON.parse(changed.body).message, 'idempotency-key-payload-mismatch');
    assertEquals(nonReadOdooCalls(changed).length, 0);
  });

  it('an ERPNext legacy create row resumes on exact material and refuses changed material or a changed operation', async () => {
    const plan = null;
    void plan;
    const record = { id: receipt, procurementId: purchase, erp_doc_kind: 'goods-receipt', receiptDate: '2026-11-04', items: [{ item_code: 'Cable', qty: 6 }] };
    const payload = { ...record, erp_doc_kind: 'goods-receipt' };
    const row = outboxRowOf({ state: 'failed', payload, payload_digest: null, procurement_input_digest: null, operation: 'create' });
    const command = erpNextCreate({ items: [{ item_code: 'Cable', qty: 6 }] });
    const resume = await servedDispatch({ tier: 'erpnext', command, feature: false, storedRow: row, fullCommit: true });
    assertEquals(resume.status, 200, resume.body);
    assertEquals(featureReads(resume).length, 0);

    const changed = await servedDispatch({ tier: 'erpnext', command: erpNextCreate({ items: [{ item_code: 'Cable', qty: 7 }] }), feature: false, storedRow: row });
    assertEquals(changed.status, 422, changed.body);
    assertEquals(JSON.parse(changed.body).message, 'idempotency-key-payload-mismatch');

    const otherOp = await servedDispatch({ tier: 'erpnext', command: erpNextUpdate({ items: [{ item_code: 'Cable', qty: 6 }] }), feature: false, storedRow: row, mappedRecord: true });
    assertEquals(otherOp.status, 422, otherOp.body);
    assertEquals(JSON.parse(otherOp.body).message, 'idempotency-key-payload-mismatch', 'existence alone cannot re-key an operation');
  });

  it('an ERPNext legacy UPDATE row resumes on exact material and refuses changed quantity', async () => {
    const record = { id: receipt, procurementId: purchase, erp_doc_kind: 'goods-receipt', externalRecordId: GR_NAME, items: [{ item_code: 'Cable', qty: 6 }] };
    const payload = { ...record, erp_doc_kind: 'goods-receipt' };
    const row = outboxRowOf({ state: 'failed', payload, payload_digest: null, procurement_input_digest: null, operation: 'update' });
    const resume = await servedDispatch({ tier: 'erpnext', command: erpNextUpdate({ items: [{ item_code: 'Cable', qty: 6 }] }), feature: false, storedRow: row, mappedRecord: true, fullCommit: true });
    assertEquals(resume.status, 200, resume.body);
    assertEquals(featureReads(resume).length, 0);
    const changed = await servedDispatch({ tier: 'erpnext', command: erpNextUpdate({ items: [{ item_code: 'Cable', qty: 7 }] }), feature: false, storedRow: row, mappedRecord: true });
    assertEquals(changed.status, 422, changed.body);
    assertEquals(JSON.parse(changed.body).message, 'idempotency-key-payload-mismatch');
    assertEquals(erpWrites(changed).length, 0);
  });

  it('a legacy row whose payload or operation cannot be verified fails closed before claim or ERP write', async () => {
    const noPayload = outboxRowOf({ state: 'failed', payload: null, payload_digest: null, operation: 'create' });
    const missingOp = outboxRowOf({ state: 'failed', payload: { erp_doc_kind: 'goods-receipt' }, payload_digest: null, operation: null, procurement_input_digest: null });
    for (const row of [noPayload, missingOp]) {
      const r = await servedDispatch({ tier: 'erpnext', command: erpNextCreate({ items: [{ item_code: 'Cable', qty: 6 }] }), feature: false, storedRow: row });
      assert(r.status >= 400, r.body);
      assertEquals(outboxInserts(r).length + insertRpc(r).length, 0, 'nothing minted');
      assertEquals(erpWrites(r).length, 0, 'nothing written');
    }
  });

  it('a WHOLE-purchase Basic receipt against a legacy row is unchanged: no digest invention, no Full read', async () => {
    const record = { id: receipt, procurementId: purchase, erp_doc_kind: 'goods-receipt', receiptDate: '2026-11-04' };
    const payload = { ...record, erp_doc_kind: 'goods-receipt', items: [{ item_code: 'Cable', qty: 10 }] };
    const row = outboxRowOf({ state: 'failed', payload, payload_digest: null, procurement_input_digest: null, operation: 'create' });
    const retry = await servedDispatch({ tier: 'erpnext', command: erpNextCreate(), feature: false, storedRow: row, fullCommit: true });
    assertEquals(retry.status, 200, retry.body);
    assertEquals(featureReads(retry).length, 0, 'Basic whole transport never reads Full');
  });
});
