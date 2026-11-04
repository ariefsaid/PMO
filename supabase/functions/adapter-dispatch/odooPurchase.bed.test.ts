/**
 * AC-OPP-010 and AC-OPP-016 (layer B, #1505 P3) on the stock Odoo bed: an approved order is created, anchored and confirmed
 * exactly once with every line's cost-account distribution, then revised in place after a partial receipt. The SHIPPED Odoo
 * procurement adapter and recovery probe run against the real JSON-2 API. Gated on the dependency, never on CI: the bed's URL,
 * database and key come from its untracked env file, sourced and never printed. Everything is synthetic and stamped; the bed
 * is throwaway, and the order is cancelled afterwards where Odoo allows.
 *   scripts/with-odoo-lock.sh bash -c 'set -a; . ./.env.odoo.local; set +a; ODOO_BED_URL=http://127.0.0.1:$ODOO_PORT \
 *     ODOO_BED_DB=$ODOO_DB ODOO_BED_KEY=$ODOO_API_KEY deno test --allow-env --allow-net --allow-read supabase/functions/adapter-dispatch/odooPurchase.bed.test.ts'
 */
import { assert, assertEquals, assertRejects } from '@std/assert';
import { createClient } from '@supabase/supabase-js';
import { AdapterError, type AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { expectedBillTotal, type BillCtx, type BillInput } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/billBody.ts';
import { externalIdentifier, parseOdooExternalRef } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/anchors.ts';
import { readOdooBedContext } from '../_shared/testing/odooBedContext.ts';
import { canonicalCommandDigest } from './moneyOutboxDeps.ts';
import { bindCall, type OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { createOdooProcurementAdapter, recoverOrder } from '../../../pmo-portal/src/lib/adapterSeam/odoo/procurementAdapter.ts';
import type { OrderCtx, OrderInput } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/orderBody.ts';
import type { ReviseLine } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/orderRevise.ts';
import { sweepOdooOrg } from '../_shared/odooSweep.ts';

const BED = Deno.env.get('ODOO_BED_URL');
const DB = Deno.env.get('ODOO_BED_DB') ?? '';
const KEY = Deno.env.get('ODOO_BED_KEY') ?? '';
const BED_CONTEXT = readOdooBedContext();
const RECOVERY_READY = Boolean(BED_CONTEXT?.odooUrl && BED_CONTEXT.odooDatabase && BED_CONTEXT.odooKey && BED_CONTEXT.supabaseUrl && BED_CONTEXT.serviceRoleKey);

Deno.test({
  name: 'AC-OPP-010 / AC-OPP-016 on the bed: one confirmed order with the project distribution on every line; revised in place after a partial receipt',
  ignore: !(BED && DB && KEY),
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const call = bindCall({ baseUrl: BED!, apiKey: KEY, database: DB, fetchImpl: fetch });
    const stamp = `P3-${Date.now()}`;
    const make = async (model: string, vals: Record<string, unknown>) => (await call<number[]>(model, 'create', { vals_list: [vals] }))[0];
    const [company] = await call<Array<{ id: number; currency_id: [number, string] }>>('res.company', 'search_read', { domain: [], fields: ['id', 'currency_id'], limit: 1 });
    const [plan] = await call<Array<{ id: number }>>('account.analytic.plan', 'search_read', { domain: [], fields: ['id'], limit: 1 });
    const partner = await make('res.partner', { name: `${stamp} vendor`, supplier_rank: 1 });
    const productA = await make('product.product', { name: `${stamp} A`, purchase_ok: true, is_storable: true, standard_price: 10 });
    const productB = await make('product.product', { name: `${stamp} B`, purchase_ok: true, is_storable: true, standard_price: 10 });
    const [{ uom_id: [uomId] }] = await call<Array<{ uom_id: [number, string] }>>('product.product', 'read', { ids: [productA], fields: ['uom_id'] });   // the product's own unit
    const account = await make('account.analytic.account', { name: `${stamp} cost account`, code: stamp, plan_id: plan.id });

    const PO_ID = crypto.randomUUID();
    const input: OrderInput = {
      vendor: `Vendor:${partner}`, caseNumber: stamp, vendorReference: `${stamp}-REF`, expectedDate: '2026-12-01', projectIds: ['p-1'],
      lines: [{ name: 'A', quantity: 10, rate: 10, unit: 'u' }, { name: 'B', quantity: 8, rate: 5.5 }],
    };
    const ctx: OrderCtx = { companyId: company.id, currencyId: company.currency_id[0], itemMap: { A: String(productA), B: String(productB) }, unitMap: { u: String(uomId) }, costAccountId: String(account), taxIds: [] };
    const state = { orderId: 0, lines: [] as ReviseLine[] };
    const adapter = createOdooProcurementAdapter({
      call, resolveOrder: () => Promise.resolve({ input, ctx }), resolveRevise: () => Promise.resolve({ orderId: state.orderId, lines: state.lines, ctx }),
      resolveBill: () => Promise.reject(new Error('no bill in this test')),
    });
    const create: AdapterCommand = { domain: 'procurement', operation: 'create', idempotencyKey: 'bed-1', record: { id: PO_ID, erp_doc_kind: 'purchase-order', procurementId: 'case-1', amount: '144.00' } };
    const attempt = async () => (await recoverOrder(call, create.record)) ?? adapter.commit(create);
    const anchored = async (name: string) => await call<Array<{ res_id: number }>>('ir.model.data', 'search_read', { domain: [['module', '=', 'pmo'], ['name', '=', name], ['model', '=', 'purchase.order']], fields: ['res_id'] });
    const lines = (orderId: number) => call<Array<{ id: number; product_id: [number, string]; product_qty: number; price_unit: number; qty_received: number; uom_id: [number, string]; analytic_distribution: Record<string, number> }>>(
      'purchase.order.line', 'search_read', { domain: [['order_id', '=', orderId]], fields: ['product_id', 'product_qty', 'price_unit', 'qty_received', 'uom_id', 'analytic_distribution'], order: 'id asc' });

    try {
      // ── AC-OPP-010
      const first = await attempt();
      const orderId = Number(String(first.externalRecordId).split(':')[1]);
      state.orderId = orderId;
      const [order] = await call<Array<{ state: string; amount_total: number; partner_id: [number, string]; partner_ref: string; origin: string; name: string }>>(
        'purchase.order', 'read', { ids: [orderId], fields: ['state', 'amount_total', 'partner_id', 'partner_ref', 'origin', 'name'] });
      assertEquals(order.state, 'purchase');
      assertEquals([order.partner_id[0], order.partner_ref, order.origin], [partner, `${stamp}-REF`, stamp]);
      assertEquals(order.amount_total, 144);
      const poLines = await lines(orderId);
      assertEquals(poLines.map((l) => [l.product_id[0], l.product_qty, l.price_unit]), [[productA, 10, 10], [productB, 8, 5.5]]);
      for (const l of poLines) assertEquals(l.analytic_distribution, { [String(account)]: 100 });
      assertEquals(poLines[0].uom_id[0], uomId);   // the mapped unit travels on the line
      assertEquals((await anchored(`po_${PO_ID.replaceAll('-', '_')}`)).map((r) => r.res_id), [orderId]);
      assertEquals(first.canonical, { id: PO_ID, po_number: order.name, amount: '144.00', pmo_amount: '144.00', erp_docstatus: 1, erp_modified: first.canonical.erp_modified, erp_amended_from: null });

      // a replay finds the same order and creates nothing
      const again = await attempt();
      assertEquals(again.externalRecordId, first.externalRecordId);
      assertEquals((await call<number[]>('purchase.order', 'search', { domain: [['origin', '=', stamp]] })).length, 1);

      // ── AC-OPP-016: receive 6 of A and 4 of B (a partial), then revise
      const [picking] = await call<Array<{ id: number; move_ids: number[] }>>('stock.picking', 'search_read', { domain: [['purchase_id', '=', orderId]], fields: ['move_ids'] });
      const moves = await call<Array<{ id: number; product_id: [number, string] }>>('stock.move', 'read', { ids: picking.move_ids, fields: ['product_id'] });
      for (const m of moves) await call('stock.move', 'write', { ids: [m.id], vals: { quantity: m.product_id[0] === productA ? 6 : 4 } });
      const validation = await call<{ res_model?: string; context?: Record<string, unknown> } | boolean>('stock.picking', 'button_validate', { ids: [picking.id] });
      if (typeof validation === 'object' && validation.res_model === 'stock.backorder.confirmation') {
        const wizard = await call<number[]>('stock.backorder.confirmation', 'create', { vals_list: [{}], context: validation.context });
        await call('stock.backorder.confirmation', 'process', { ids: wizard, context: validation.context });
      }
      assertEquals((await lines(orderId)).map((l) => l.qty_received), [6, 4]);

      const revise = (revision: number): AdapterCommand => ({ domain: 'procurement', operation: 'revise' as never, idempotencyKey: `bed-rev-${revision}`, record: { id: crypto.randomUUID(), erp_doc_kind: 'purchase-order', poId: PO_ID, revision } });
      const target = (a: string, b: string): ReviseLine[] => [{ itemRef: 'A', quantity: a, rate: '10.00', unit: '' }, { itemRef: 'B', quantity: b, rate: '5.50', unit: '' }];

      state.lines = target('12.000', '6.000');   // raises A, lowers B (still above the 4 received)
      const rev2 = await adapter.commit(revise(2));
      assertEquals((await lines(orderId)).map((l) => l.product_qty), [12, 6]);
      assertEquals(rev2.canonical.id, PO_ID);
      assertEquals(rev2.canonical.amount, '153.00');
      assertEquals((await anchored(`porev_${PO_ID.replaceAll('-', '_')}_2`)).length, 1);

      const replay = await adapter.commit(revise(2));   // replay: nothing changes
      assertEquals((await lines(orderId)).map((l) => l.product_qty), [12, 6]);
      assertEquals(replay.canonical.amount, '153.00');

      state.lines = target('5.000', '6.000');   // below the 6 received of A
      const refusal = await assertRejects(() => adapter.commit(revise(3))) as { code?: string; message: string };
      assertEquals([refusal.code, refusal.message], ['commit-rejected', 'below-received: A']);
      assertEquals((await lines(orderId)).map((l) => l.product_qty), [12, 6]);
      assertEquals((await anchored(`porev_${PO_ID.replaceAll('-', '_')}_3`)).length, 0);

      const [after] = await call<Array<{ state: string }>>('purchase.order', 'read', { ids: [orderId], fields: ['state'] });
      assert(after.state === 'purchase', `the order is never cancelled by a revision (state ${after.state})`);
    } finally {
      // best effort: the bed is throwaway, and a received order cannot be cancelled
      const ids = await call<number[]>('purchase.order', 'search', { domain: [['origin', '=', stamp]] }).catch(() => []);
      if (ids.length) await call('purchase.order', 'button_cancel', { ids }).catch(() => undefined);
    }
  },
});


Deno.test({
  name: 'AC-OPP-062 on the bed: sweep recovers one lost bill-post response and holds an edited anchor',
  ignore: !RECOVERY_READY,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const bed = BED_CONTEXT!;
    const bedUrl = new URL(bed.odooUrl);
    const raw = bindCall({ baseUrl: bed.odooUrl, apiKey: bed.odooKey, database: bed.odooDatabase, fetchImpl: fetch });
    const sc = createClient(bed.supabaseUrl, bed.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const stamp = `P9-R-${Date.now()}`;
    const hostGuardEnv = ['SUPABASE_URL', 'ERPNEXT_ALLOW_LOCAL_BENCH', 'ERPNEXT_LOCAL_BENCH_ORIGINS']
      .map((name) => [name, Deno.env.get(name)] as const);
    Deno.env.set('SUPABASE_URL', bed.supabaseUrl);
    Deno.env.set('ERPNEXT_ALLOW_LOCAL_BENCH', '1');
    Deno.env.set('ERPNEXT_LOCAL_BENCH_ORIGINS', bedUrl.origin);
    const must = async <T>(p: PromiseLike<{ data: T; error: { message: string; code?: string } | null }>) => {
      const { data, error } = await p;
      if (error) throw new Error(error.message);
      return data;
    };
    const orgId = crypto.randomUUID();
    const vendorId = crypto.randomUUID();
    const caseIds = [crypto.randomUUID(), crypto.randomUUID()];
    const email = `p9-${crypto.randomUUID()}@example.test`;
    const cases: Array<{ pmoId: string; procurementId: string; idempotencyKey: string; partnerId: number; productId: number; moveId: number; outboxId: string }> = [];
    let actorId: string | null = null;
    let secretRef: string | null = null;
    let partnerId = 0;
    let productId = 0;
    const [bedCompany] = await raw<Array<{ id: number; name: string; currency_id: [number, string] }>>('res.company', 'search_read', {
      domain: [], fields: ['id', 'name', 'currency_id'], limit: 1,
    });
    assert(bedCompany, 'the Odoo bed exposes a company for the temporary binding');
    const companyId = bedCompany.id;
    const call: OdooCall = <T>(model: string, method: string, body: Record<string, unknown> = {}) => raw<T>(model, method, {
      ...body, context: { allowed_company_ids: [companyId], ...((body.context as object) ?? {}) },
    });
    const make = async (model: string, vals: Record<string, unknown>) => (await call<number[]>(model, 'create', { vals_list: [vals] }))[0];
    const [company] = await call<Array<{ currency_id: [number, string] }>>('res.company', 'read', { ids: [companyId], fields: ['currency_id'] });
    const fixture: BillInput = {
      vendor: '', reference: '', invoiceDate: '2026-11-04', projectIds: [],
      lines: [{ name: 'service', quantity: 1, rate: 100, purchaseLineId: null }],
    };
    const billCtx = (): BillCtx => ({ companyId, currencyId: company.currency_id[0], itemMap: { service: String(productId) }, unitMap: {}, costAccountId: null, taxes: [] });
    const upsertCase = async (procurementId: string, suffix: string) => {
      await must(sc.from('procurements').insert({
        id: procurementId, org_id: orgId, code: `${stamp}-${suffix}`, title: `${stamp} ${suffix}`, vendor_id: vendorId,
        currency: company.currency_id[1], total_value: 100, status: 'Approved',
      }).select());
      await must(sc.from('procurement_items').insert({
        org_id: orgId, procurement_id: procurementId, name: 'service', description: `${stamp} line`, quantity: 1, rate: 100,
      }).select());
    };
    const provisionBinding = async () => {
      await must(sc.from('organizations').insert({ id: orgId, name: `${stamp} org` }).select());
      const created = await sc.auth.admin.createUser({ email, password: `${crypto.randomUUID()}Aa1!`, email_confirm: true });
      if (created.error || !created.data.user) throw new Error('could not create the temporary Odoo recovery actor');
      actorId = created.data.user.id;
      await must(sc.from('profiles').insert({ id: actorId, org_id: orgId, full_name: `${stamp} admin`, email, role: 'Admin', status: 'active' }).select());
      secretRef = await must(sc.rpc('stage_vault_secret_for_org', {
        p_org_id: orgId, p_external_tier: 'odoo', p_secret_value: bed.odooKey, p_secret_name: `${stamp}-secret`, p_actor_id: actorId,
      })) as string;
      await must(sc.rpc('finalize_odoo_connect', {
        p_org_id: orgId, p_secret_ref: secretRef, p_site_url: bedUrl.origin, p_database: bed.odooDatabase,
        p_key_expires_on: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
        p_discard: false, p_kill_switch_enabled: true, p_actor_id: actorId,
      }));
      const directoryModels = [
        'res.company', 'account.analytic.plan', 'account.analytic.account', 'account.account', 'account.tax', 'account.journal',
        'uom.uom', 'product.product', 'stock.warehouse', 'stock.location', 'res.partner',
      ];
      const models = Object.fromEntries(directoryModels.map((model) => [model, {
        exists: true, read: model === 'account.journal', create: false, write: false, unlink: false, fields_missing: [],
      }]));
      const capability = {
        observed_at: new Date().toISOString(), version_major: 20, untested_version: false, companies: [], missing: [], models,
        later: {
          'purchase.order': true, 'purchase.order.line': true, 'stock.picking': true, 'stock.move': true,
          'account.move': true, 'account.payment': true,
        },
      };
      await must(sc.rpc('activate_odoo_binding', {
        p_org_id: orgId, p_version_major: 20, p_company_id: companyId, p_company_name: bedCompany.name,
        p_config_patch: { capabilities: capability, item_map: { service: String(productId) }, unit_map: {}, purchase_tax_ids: [] }, p_actor_id: actorId,
      }));
      await must(sc.from('external_domain_ownership').insert({ org_id: orgId, external_tier: 'odoo', domain: 'procurement' }).select());
      await must(sc.from('companies').insert({ id: vendorId, org_id: orgId, name: `${stamp} vendor`, type: 'Vendor' }).select());
      await must(sc.from('external_refs').insert({
        org_id: orgId, domain: 'companies', pmo_record_id: vendorId, external_tier: 'odoo', external_record_id: `Vendor:${partnerId}`,
      }).select());
    };
    const stageLostResponse = async (suffix: string, procurementId: string, editAnchor: boolean) => {
      const pmoId = crypto.randomUUID();
      const idempotencyKey = `${stamp}-${suffix}-submit`;
      const reference = `${stamp}-${suffix}`;
      fixture.vendor = `Vendor:${partnerId}`;
      fixture.reference = reference;
      const command: AdapterCommand = {
        domain: 'procurement', operation: 'create', idempotencyKey,
        record: {
          id: pmoId, erp_doc_kind: 'purchase-invoice', procurementId, referenceNumber: reference,
          invoiceDate: fixture.invoiceDate, odoo_expected_total: expectedBillTotal(fixture, []), odoo_cost_account: null,
        },
      };
      let lostPostResponse = false;
      const cutAfterPost: OdooCall = async <T>(model: string, method: string, body: Record<string, unknown> = {}) => {
        const result = await call<T>(model, method, body);
        if (!lostPostResponse && model === 'account.move' && method === 'action_post') {
          lostPostResponse = true;
          throw new AdapterError('external-unreachable', 'simulated response cut after the bill was posted');
        }
        return result;
      };
      const adapter = createOdooProcurementAdapter({
        call: cutAfterPost,
        resolveOrder: () => Promise.reject(new Error('not an order command')),
        resolveRevise: () => Promise.reject(new Error('not a revision command')),
        resolveBill: () => Promise.resolve({ input: fixture, ctx: billCtx() }),
      });
      const lost = await assertRejects(() => adapter.commit(command), Error);
      assertEquals((lost as AdapterError).code, 'external-unreachable');
      assert(lostPostResponse, 'the Odoo post committed before the response was cut');
      const matches = await call<number[]>('account.move', 'search', { domain: [
        ['move_type', '=', 'in_invoice'], ['ref', '=', reference], ['partner_id', '=', partnerId],
      ] });
      assertEquals(matches.length, 1, 'the cut left exactly one vendor bill in Odoo');
      const moveId = matches[0];
      const entry = { pmoId, procurementId, idempotencyKey, partnerId, productId, moveId, outboxId: '' };
      cases.push(entry);
      const [posted] = await call<Array<{ state: string }>>('account.move', 'read', { ids: [moveId], fields: ['state'] });
      assertEquals(posted.state, 'posted');
      if (editAnchor) {
        const anchor = externalIdentifier(`bill:${pmoId}`);
        const ids = await call<number[]>('ir.model.data', 'search', { domain: [
          ['module', '=', anchor.module], ['name', '=', anchor.name], ['model', '=', 'account.move'],
        ] });
        assertEquals(ids.length, 1, 'the posted bill has one stock external identifier');
        await call('ir.model.data', 'write', { ids, vals: { module: 'edited' } });
      }
      const record = command.record as Record<string, unknown>;
      const outboxPayload = {
        ...record, odoo_partner_id: partnerId, odoo_amount: '100.00', odoo_line_count: 1,
        created_after: new Date(Date.now() - 5 * 60_000).toISOString().slice(0, 19).replace('T', ' '),
        created_before: new Date(Date.now() + 60_000).toISOString().slice(0, 19).replace('T', ' '),
      };
      const digestMaterial = Object.fromEntries(Object.entries(outboxPayload).filter(([key]) => ![
        'odoo_expected_total', 'odoo_cost_account', 'odoo_bill_ref', 'odoo_adopted_ref', 'odoo_absent_confirmed', 'created_after', 'created_before',
      ].includes(key)));
      const payloadDigest = await canonicalCommandDigest({ domain: 'procurement', operation: 'create', record: digestMaterial });
      const now = Date.now();
      await must(sc.from('external_command_outbox').insert({
        org_id: orgId, domain: 'procurement', pmo_record_id: pmoId, idempotency_key: idempotencyKey, external_tier: 'odoo', actor_user_id: actorId,
        operation: 'create', state: 'quarantined', payload: outboxPayload, payload_digest: payloadDigest, attempt_count: 1, claim_generation: 2,
        claimed_at: new Date(now - 6 * 60_000).toISOString(), reconcile_after: new Date(now - 60_000).toISOString(),
        updated_at: new Date(now - 6 * 60_000).toISOString(),
      }).select());
      const stored = await must(sc.from('external_command_outbox').select('id').eq('org_id', orgId)
        .eq('domain', 'procurement').eq('pmo_record_id', pmoId).eq('idempotency_key', idempotencyKey).single()) as { id: string };
      entry.outboxId = stored.id;
      return entry;
    };

    try {
      partnerId = await make('res.partner', { name: `${stamp} supplier`, supplier_rank: 1 });
      productId = await make('product.product', { name: `${stamp} service`, type: 'service', purchase_ok: true });
      await provisionBinding();
      await upsertCase(caseIds[0], 'adopt');
      await upsertCase(caseIds[1], 'edited');
      await stageLostResponse('adopt', caseIds[0], false);
      await stageLostResponse('edited', caseIds[1], true);

      const adopt = cases[0];
      const edited = cases[1];
      const tick = await sweepOdooOrg(sc, orgId, { maxCalls: 2_000 });
      if (!('ok' in tick)) throw new Error(`the Odoo sweep reaches procurement recovery: ${JSON.stringify(tick)}`);
      assertEquals(tick.outbox_procurement_reconciled, 1,
        `one posted bill is confirmed by the sweep; recovery errors: ${tick.outbox_procurement_errors.map(({ error }) => error).join(', ') || 'none'}`);
      assert(tick.outbox_procurement_errors.some((error) => error.id === edited.outboxId), 'the edited anchor is surfaced as held');
      const firstOutbox = await must(sc.from('external_command_outbox').select('state,external_record_id')
        .eq('org_id', orgId).eq('id', adopt.outboxId).single()) as { state: string; external_record_id: string | null };
      const heldOutbox = await must(sc.from('external_command_outbox').select('state')
        .eq('org_id', orgId).eq('id', edited.outboxId).single()) as { state: string };
      assertEquals(firstOutbox.state, 'confirmed');
      assertEquals(parseOdooExternalRef('account.move', firstOutbox.external_record_id), adopt.moveId);
      assertEquals(heldOutbox.state, 'held', 'an edited stock anchor is held instead of creating another bill');
      const firstRef = await must(sc.from('external_refs').select('external_record_id').eq('org_id', orgId)
        .eq('domain', 'procurement').eq('pmo_record_id', adopt.pmoId).single()) as { external_record_id: string };
      assertEquals(parseOdooExternalRef('account.move', firstRef.external_record_id), adopt.moveId);
      const firstMirror = await must(sc.from('procurement_invoices').select('status,erp_docstatus,erp_outstanding_amount')
        .eq('org_id', orgId).eq('id', adopt.pmoId).single()) as { status: string; erp_docstatus: number; erp_outstanding_amount: number };
      assertEquals([firstMirror.status, firstMirror.erp_docstatus, Number(firstMirror.erp_outstanding_amount)], ['Received', 1, 100]);
      const editedRef = await must(sc.from('external_refs').select('pmo_record_id').eq('org_id', orgId)
        .eq('domain', 'procurement').eq('pmo_record_id', edited.pmoId).maybeSingle());
      assertEquals(editedRef, null, 'a held command has no external link');
      for (const entry of cases) {
        const ids = await call<number[]>('account.move', 'search', { domain: [
          ['move_type', '=', 'in_invoice'], ['ref', '=', `${stamp}-${entry === adopt ? 'adopt' : 'edited'}`], ['partner_id', '=', partnerId],
        ] });
        assertEquals(ids, [entry.moveId], 'recovery keeps exactly one Odoo bill for each PMO record');
      }
    } finally {
      for (const entry of cases) {
        await sc.from('external_command_outbox').delete().eq('org_id', orgId).eq('domain', 'procurement').eq('pmo_record_id', entry.pmoId);
        await sc.from('external_refs').delete().eq('org_id', orgId).eq('pmo_record_id', entry.pmoId);
        await sc.from('procurement_invoices').delete().eq('org_id', orgId).eq('id', entry.pmoId);
      }
      await sc.from('external_refs').delete().eq('org_id', orgId).eq('pmo_record_id', vendorId);
      await sc.from('procurement_items').delete().eq('org_id', orgId);
      await sc.from('procurements').delete().eq('org_id', orgId);
      await sc.from('companies').delete().eq('org_id', orgId);
      if (actorId) {
        await Promise.resolve(sc.rpc('disconnect_external_integration', { p_org_id: orgId, p_external_tier: 'odoo', p_actor_id: actorId })).catch(() => {});
        await sc.auth.admin.deleteUser(actorId).catch(() => {});
      }
      await Promise.resolve(sc.from('organizations').delete().eq('id', orgId).throwOnError()).catch(() => {});
      for (const entry of cases) {
        const ids = await call<number[]>('ir.model.data', 'search', { domain: [['model', '=', 'account.move'], ['name', '=', `bill_${entry.pmoId.replaceAll('-', '_')}`]] }).catch(() => []);
        if (ids.length) await call('ir.model.data', 'unlink', { ids }).catch(() => {});
        await call('account.move', 'button_draft', { ids: [entry.moveId] }).catch(() => {});
        await call('account.move', 'unlink', { ids: [entry.moveId] }).catch(() => {});
      }
      if (productId) await call('product.product', 'unlink', { ids: [productId] }).catch(() => {});
      if (partnerId) await call('res.partner', 'unlink', { ids: [partnerId] }).catch(() => {});
      for (const [name, value] of hostGuardEnv) {
        if (value === undefined) Deno.env.delete(name);
        else Deno.env.set(name, value);
      }
    }
  },
});
