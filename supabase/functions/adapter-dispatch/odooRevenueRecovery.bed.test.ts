/**
 * AC-OCI-062 (layer B, #1506 C6): a lost response after Odoo commits `action_post` is recovered through the shipped invoice probe,
 * which adopts the one anchored invoice without posting/creating twice. If its stock external identifier is edited out of the `pmo`
 * namespace, a bounded composite finds an unanchored customer invoice and returns `ambiguous-anchor`, the money outbox's held path.
 * The bed is synthetic and disposable; C5's receipt recovery half is deferred because that push is not in this slice.
 * Pass a private, throwaway bed-context JSON path as the test script argument to enable the bed.
 */
import { assert, assertEquals, assertRejects } from '@std/assert';
import { createClient } from '@supabase/supabase-js';
import type { AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { bindCall, type OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { createOdooRevenueAdapter, invoiceKey, recoverInvoice } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenueAdapter.ts';
import { externalIdentifier, ODOO_REVENUE_ANCHORS } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/anchors.ts';
import type { InvoiceMaps, PmoInvoice } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/invoiceBody.ts';
import { expectedInvoiceTotal, type InvoiceExpect } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/invoiceReadBack.ts';
import { parseOdooExternalRef } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/anchors.ts';
import { canonicalCommandDigest } from './moneyOutboxDeps.ts';
import { sweepOdooOrg } from '../_shared/odooSweep.ts';
import { readOdooBedContext } from '../_shared/testing/odooBedContext.ts';

const BED_CONTEXT = readOdooBedContext();
const BED = BED_CONTEXT?.odooUrl;
const DB = BED_CONTEXT?.odooDatabase ?? '';
const KEY = BED_CONTEXT?.odooKey ?? '';
const SUPABASE_ENDPOINT = BED_CONTEXT?.supabaseUrl;
const SERVICE = BED_CONTEXT?.serviceRoleKey;
const SWEEP_READY = Boolean(BED && DB && KEY && SUPABASE_ENDPOINT && SERVICE);

Deno.test({
  name: 'AC-OCI-062 on the bed: lost post response recovers one invoice; an edited anchor is held as ambiguous',
  ignore: !(BED && DB && KEY),
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const raw = bindCall({ baseUrl: BED!, apiKey: KEY, database: DB, fetchImpl: fetch });
    const stamp = `C6-R-${Date.now()}`;
    let companyId = 0;
    let incomeId = 0;
    for (const { id } of await raw<Array<{ id: number }>>('res.company', 'search_read', { domain: [], fields: ['id'] })) {
      const [income] = await raw<Array<{ id: number }>>('account.account', 'search_read', {
        domain: [['account_type', '=', 'income'], ['company_ids', 'in', [id]]], fields: ['id'], limit: 1,
        context: { allowed_company_ids: [id] },
      });
      if (income) { companyId = id; incomeId = income.id; break; }
    }
    assert(companyId, 'the Odoo bed has a company income account');
    const call = (async (model: string, method: string, body: Record<string, unknown> = {}) => raw(model, method, {
      ...body, context: { allowed_company_ids: [companyId], ...((body.context as object) ?? {}) },
    })) as OdooCall;
    const make = async (model: string, vals: Record<string, unknown>) => (await call<number[]>(model, 'create', { vals_list: [vals] }))[0];
    const [company] = await call<Array<{ currency_id: [number, string] }>>('res.company', 'read', { ids: [companyId], fields: ['currency_id'] });
    const partnerId = await make('res.partner', { name: `${stamp} client`, customer_rank: 1 });
    const serviceId = await make('product.product', { name: `${stamp} service`, type: 'service', sale_ok: true });
    const id = crypto.randomUUID();
    const lines = [{ itemId: 'svc', description: `${stamp} line`, quantity: 1, unitPrice: 1000 }];
    const input: PmoInvoice = { id, customerId: 'client', invoiceDate: '2026-11-03', currency: company.currency_id[1], referenceNumber: stamp, lines };
    const maps: InvoiceMaps = {
      companyCurrency: company.currency_id[1], partners: { client: partnerId },
      items: { svc: { productId: serviceId, incomeAccountId: incomeId } }, units: {}, costAccountId: null, taxIds: [],
    };
    const expect: InvoiceExpect = { total: expectedInvoiceTotal(lines, []), costAccountId: null };
    const command: AdapterCommand = { domain: 'revenue', operation: 'transition', idempotencyKey: `${stamp}-submit`,
      record: { id, erp_doc_kind: 'sales-invoice', verb: 'submit' } };
    let lostPostResponse = false;
    const cutAfterPost: OdooCall = async <T>(model: string, method: string, body: Record<string, unknown> = {}) => {
      const result = await call<T>(model, method, body);
      if (!lostPostResponse && model === 'account.move' && method === 'action_post') {
        lostPostResponse = true;
        throw new Error('simulated network cut after remote commit');
      }
      return result;
    };
    const adapter = createOdooRevenueAdapter({ call: cutAfterPost, resolveInvoice: async () => ({ input, maps, expect }) });
    const base = `${stamp}`;
    try {
      await assertRejects(() => adapter.commit(command), Error, 'simulated network cut after remote commit');
      assert(lostPostResponse);
      const firstIds = await call<number[]>('account.move', 'search', { domain: [['move_type', '=', 'out_invoice'], ['ref', '=', base], ['partner_id', '=', partnerId]] });
      assertEquals(firstIds.length, 1, 'one committed invoice exists after the cut');

      const recovered = await recoverInvoice(call, command.record, undefined, expect);
      if (!recovered) throw new Error('the committed invoice is recoverable through its stock external identifier');
      assertEquals(parseOdooExternalRef('account.move', recovered.externalRecordId), firstIds[0]);
      assertEquals([recovered.canonical.odoo_state, recovered.canonical.erp_docstatus], ['posted', 1]);
      const postCallsBeforeEdit = (await call<Array<{ state: string }>>('account.move', 'read', { ids: firstIds, fields: ['state'] }))[0].state;
      assertEquals(postCallsBeforeEdit, 'posted');
      assertEquals((await call<number[]>('account.move', 'search', { domain: [['move_type', '=', 'out_invoice'], ['ref', '=', base], ['partner_id', '=', partnerId]] })).length, 1);

      const { module, name } = externalIdentifier(invoiceKey({ id }));
      await call('ir.model.data', 'write', { ids: (await call<number[]>('ir.model.data', 'search', { domain: [['module', '=', module], ['name', '=', name], ['model', '=', 'account.move']] })),
        vals: { module: 'edited' } });
      const createdAfter = new Date(Date.now() - 5 * 60_000).toISOString().slice(0, 19).replace('T', ' ');
      const createdBefore = new Date(Date.now() + 60_000).toISOString().slice(0, 19).replace('T', ' ');
      const held = await assertRejects(() => recoverInvoice(call, command.record, { partnerId, createdAfter, createdBefore }, expect), Error);
      assertEquals(held.message, 'ambiguous-anchor', 'the recovery probe refuses to adopt or recreate an invoice after its anchor is edited');
      assertEquals((await call<number[]>('account.move', 'search', { domain: [['move_type', '=', 'out_invoice'], ['ref', '=', base], ['partner_id', '=', partnerId]] })).length, 1,
        'the held recovery does not mint a duplicate');
    } finally {
      // A posted move is permanent bed evidence; remove only anything still draft.
      const ids = await call<number[]>('account.move', 'search', { domain: [['move_type', '=', 'out_invoice'], ['ref', '=', base], ['partner_id', '=', partnerId]] }).catch(() => []);
      for (const moveId of ids) {
        await call('account.move', 'button_draft', { ids: [moveId] }).catch(() => {});
        await call('account.move', 'unlink', { ids: [moveId] }).catch(() => {});
      }
      await call('res.partner', 'unlink', { ids: [partnerId] }).catch(() => {});
    }
  },
});

Deno.test({
  name: 'AC-OCI-062 on the bed: the Odoo sweep confirms one committed invoice and holds an edited anchor',
  ignore: !SWEEP_READY,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const bed = new URL(BED!);
    const sc = createClient(SUPABASE_ENDPOINT!, SERVICE!, { auth: { persistSession: false, autoRefreshToken: false } });
    const raw = bindCall({ baseUrl: BED!, apiKey: KEY, database: DB, fetchImpl: fetch });
    const stamp = `C6-SWEEP-${Date.now()}`;
    const hostGuardEnv = ['SUPABASE_URL', 'ERPNEXT_ALLOW_LOCAL_BENCH', 'ERPNEXT_LOCAL_BENCH_ORIGINS']
      .map((key) => [key, Deno.env.get(key)] as const);
    Deno.env.set('SUPABASE_URL', SUPABASE_ENDPOINT!);
    Deno.env.set('ERPNEXT_ALLOW_LOCAL_BENCH', '1');
    Deno.env.set('ERPNEXT_LOCAL_BENCH_ORIGINS', bed.origin);
    const must = async <T>(p: PromiseLike<{ data: T; error: { message: string; code?: string } | null }>) => {
      const { data, error } = await p;
      if (error) throw new Error(error.message);
      return data;
    };
    const orgId = crypto.randomUUID();
    const email = `c6-${crypto.randomUUID()}@example.test`;
    const [bedCompany] = await raw<Array<{ id: number; name: string; currency_id: [number, string] }>>('res.company', 'search_read', {
      domain: [], fields: ['id', 'name', 'currency_id'], limit: 1,
    });
    assert(bedCompany, 'the Odoo bed exposes a company for the temporary binding');
    const companyId = bedCompany.id;
    const call: OdooCall = async <T>(model: string, method: string, body: Record<string, unknown> = {}) => raw<T>(model, method, {
      ...body, context: { allowed_company_ids: [companyId], ...((body.context as object) ?? {}) },
    });
    const [company] = await call<Array<{ currency_id: [number, string] }>>('res.company', 'read', { ids: [companyId], fields: ['currency_id'] });
    const [income] = await call<Array<{ id: number }>>('account.account', 'search_read', {
      domain: [['account_type', '=', 'income'], ['company_ids', 'in', [companyId]]], fields: ['id'], limit: 1,
    });
    assert(income, 'the Odoo bed has an income account for invoice lines');
    let actorId: string | null = null;
    let secretRef: string | null = null;
    const cases: Array<{ id: string; pmoId: string; customerId: string; partnerId: number; productId: number; moveId: number }> = [];
    const provisionBinding = async () => {
      await must(sc.from('organizations').insert({ id: orgId, name: `${stamp} org` }).select());
      const created = await sc.auth.admin.createUser({ email, password: `${crypto.randomUUID()}Aa1!`, email_confirm: true });
      if (created.error || !created.data.user) throw new Error('could not create the temporary Odoo recovery actor');
      const newActorId = created.data.user.id;
      actorId = newActorId;
      await must(sc.from('profiles').insert({
        id: newActorId, org_id: orgId, full_name: `${stamp} admin`, email, role: 'Admin', status: 'active',
      }).select());
      const staged = await must(sc.rpc('stage_vault_secret_for_org', {
        p_org_id: orgId, p_external_tier: 'odoo', p_secret_value: KEY, p_secret_name: `${stamp}-secret`, p_actor_id: newActorId,
      })) as string;
      secretRef = staged;
      await must(sc.rpc('finalize_odoo_connect', {
        p_org_id: orgId, p_secret_ref: secretRef, p_site_url: bed.origin, p_database: DB,
        p_key_expires_on: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
        p_discard: false, p_kill_switch_enabled: true, p_actor_id: newActorId,
      }));
      const directoryModels = [
        'res.company', 'account.analytic.plan', 'account.analytic.account', 'account.account', 'account.tax', 'account.journal',
        'uom.uom', 'product.product', 'stock.warehouse', 'stock.location', 'res.partner',
      ];
      const models = Object.fromEntries(directoryModels.map((model) => [model, {
        exists: true, read: ['account.account', 'account.tax', 'account.journal'].includes(model),
        create: false, write: false, unlink: false, fields_missing: [],
      }]));
      const capability = {
        observed_at: new Date().toISOString(), version_major: 20, untested_version: false, companies: [], missing: [], models,
        later: { 'account.move': true, 'account.move.line': true, 'account.payment': true },
      };
      await must(sc.rpc('activate_odoo_binding', {
        p_org_id: orgId, p_version_major: 20, p_company_id: companyId, p_company_name: bedCompany.name,
        p_config_patch: { capabilities: capability }, p_actor_id: newActorId,
      }));
      await must(sc.from('external_domain_ownership').insert({ org_id: orgId, external_tier: 'odoo', domain: 'revenue' }).select());
    };
    const createRecoveryCase = async (suffix: string, editAnchor: boolean) => {
      const pmoId = crypto.randomUUID();
      const customerId = crypto.randomUUID();
      const entry = { id: '', pmoId, customerId, partnerId: 0, productId: 0, moveId: 0 };
      cases.push(entry);
      const [partnerId] = await call<number[]>('res.partner', 'create', { vals_list: [{ name: `${stamp} ${suffix} client`, customer_rank: 1 }] });
      entry.partnerId = partnerId;
      const [productId] = await call<number[]>('product.product', 'create', { vals_list: [{
        name: `${stamp} ${suffix} service`, type: 'service', sale_ok: true, property_account_income_id: income.id,
      }] });
      entry.productId = productId;
      const referenceNumber = `${stamp}-${suffix}`;
      const lines = [{ itemId: 'C6-BED-SVC', description: `${stamp} line`, quantity: 1, unitPrice: 1000 }];
      const input: PmoInvoice = { id: pmoId, customerId, invoiceDate: '2026-11-03', currency: company.currency_id[1], referenceNumber, lines };
      const maps: InvoiceMaps = {
        companyCurrency: company.currency_id[1], partners: { [customerId]: partnerId },
        items: { 'C6-BED-SVC': { productId, incomeAccountId: income.id } }, units: {}, costAccountId: null, taxIds: [],
      };
      const expect: InvoiceExpect = { total: expectedInvoiceTotal(lines, []), costAccountId: null };
      const command: AdapterCommand = {
        domain: 'revenue', operation: 'transition', idempotencyKey: `${stamp}-${suffix}-submit`,
        record: { id: pmoId, erp_doc_kind: 'sales-invoice', verb: 'submit' },
      };
      let lostPostResponse = false;
      const cutAfterPost: OdooCall = async <T>(model: string, method: string, body: Record<string, unknown> = {}) => {
        const result = await call<T>(model, method, body);
        if (!lostPostResponse && model === 'account.move' && method === 'action_post') {
          lostPostResponse = true;
          throw new Error('simulated response cut after Odoo commits the invoice');
        }
        return result;
      };
      const adapter = createOdooRevenueAdapter({ call: cutAfterPost, resolveInvoice: async () => ({ input, maps, expect }) });
      await assertRejects(() => adapter.commit(command), Error, 'simulated response cut after Odoo commits the invoice');
      assert(lostPostResponse);
      const [moveId] = await call<number[]>('account.move', 'search', { domain: [
        ['move_type', '=', 'out_invoice'], ['ref', '=', referenceNumber], ['partner_id', '=', partnerId],
      ] });
      assert(moveId, 'the cut left one posted customer invoice in Odoo');
      entry.moveId = moveId;
      if (editAnchor) {
        const anchor = externalIdentifier(invoiceKey({ id: pmoId }));
        const externalIds = await call<number[]>(ODOO_REVENUE_ANCHORS['sales-invoice'].model, 'search', { domain: [
          ['module', '=', anchor.module], ['name', '=', anchor.name], ['model', '=', 'account.move'],
        ] });
        assertEquals(externalIds.length, 1);
        await call('ir.model.data', 'write', { ids: externalIds, vals: { module: 'edited' } });
      }

      await must(sc.from('companies').insert({ id: customerId, org_id: orgId, name: `${stamp} ${suffix}`, type: 'Client' }).select());
      await must(sc.from('external_refs').insert({ org_id: orgId, domain: 'companies', pmo_record_id: customerId,
        external_tier: 'odoo', external_record_id: `Client:${partnerId}` }).select());
      const record = {
        id: pmoId, erp_doc_kind: 'sales-invoice', verb: 'submit', customerId, projectId: null, workOrderId: null,
        currency: company.currency_id[1], items: [{ item_code: 'C6-BED-SVC', qty: 1, rate: 1000, description: `${stamp} line` }],
        reference_number: referenceNumber,
      };
      await must(sc.from('sales_invoices').insert({
        id: pmoId, org_id: orgId, customer_id: customerId, project_id: null, amount: 1000, tax_amount: 0,
        tax_treatment: 'exclusive', currency: company.currency_id[1], invoice_date: '2026-11-03', reference_number: referenceNumber, status: 'Draft',
        native_lines: [{ item_code: 'C6-BED-SVC', description: `${stamp} line`, qty: 1, rate: 1000 }],
      }).select());
      const createdAfter = new Date(Date.now() - 5 * 60_000).toISOString().slice(0, 19).replace('T', ' ');
      const createdBefore = new Date(Date.now() + 60_000).toISOString().slice(0, 19).replace('T', ' ');
      const payload = {
        ...record, odoo_partner_id: partnerId, odoo_expected_total: '1000.00', odoo_cost_account: null,
        created_after: createdAfter, created_before: createdBefore,
      };
      const material = Object.fromEntries(Object.entries(payload).filter(([key]) => ![
        'odoo_expected_total', 'odoo_cost_account', 'odoo_partner_id', 'created_after', 'created_before',
      ].includes(key)));
      const payloadDigest = await canonicalCommandDigest({ domain: 'revenue', operation: 'create', record: material });
      const now = Date.now();
      const idempotencyKey = command.idempotencyKey!;
      await must(sc.from('external_command_outbox').insert({
        org_id: orgId, domain: 'revenue', pmo_record_id: pmoId, idempotency_key: idempotencyKey, external_tier: 'odoo', actor_user_id: actorId,
        operation: 'create', state: 'quarantined', payload, payload_digest: payloadDigest, attempt_count: 1, claim_generation: 2,
        claimed_at: new Date(now - 6 * 60_000).toISOString(), reconcile_after: new Date(now - 60_000).toISOString(),
        updated_at: new Date(now - 6 * 60_000).toISOString(),
      }).select());
      const stored = await must(sc.from('external_command_outbox').select('id').eq('org_id', orgId)
        .eq('domain', 'revenue').eq('pmo_record_id', pmoId).eq('idempotency_key', idempotencyKey).single()) as { id: string };
      entry.id = stored.id;
      if (suffix === 'adopt') {
        await must(sc.from('external_command_outbox').update({
          state: 'failed', claim_generation: 3, last_error: 'hold resolved (adopt)',
          payload: { ...payload, odoo_adopted_ref: `account.move:${moveId}` },
        }).eq('org_id', orgId).eq('id', stored.id).select());
      }
    };

    try {
      await provisionBinding();
      await createRecoveryCase('adopt', true);
      await createRecoveryCase('edited', true);
      const tick = await sweepOdooOrg(sc, orgId, { maxCalls: 2_000 });
      if (!('ok' in tick)) throw new Error(`the Odoo tick reaches the recovery pass: ${JSON.stringify(tick)}`);
      assertEquals(tick.outbox_reconciled, 1,
        `one committed invoice is confirmed by the sweep; recovery errors: ${tick.outbox_errors.map(({ error }) => error).join(', ') || 'none'}`);
      assert(tick.outbox_errors.some((error) => error.id === cases[1].id), 'the edited anchor is surfaced as held');

      const first = cases[0];
      const second = cases[1];
      const firstOutbox = await must(sc.from('external_command_outbox').select('state,external_record_id')
        .eq('org_id', orgId).eq('id', first.id).single()) as { state: string; external_record_id: string | null };
      const secondOutbox = await must(sc.from('external_command_outbox').select('state,last_error')
        .eq('org_id', orgId).eq('id', second.id).single()) as { state: string; last_error: string | null };
      assertEquals(firstOutbox.state, 'confirmed');
      assertEquals(parseOdooExternalRef('account.move', firstOutbox.external_record_id), first.moveId);
      assertEquals(secondOutbox.state, 'held', 'an edited stock anchor never causes a duplicate invoice');
      const reference = await must(sc.from('external_refs').select('external_record_id').eq('org_id', orgId)
        .eq('domain', 'revenue').eq('pmo_record_id', first.pmoId).single()) as { external_record_id: string };
      assertEquals(parseOdooExternalRef('account.move', reference.external_record_id), first.moveId);
      const mirror = await must(sc.from('sales_invoices').select('status,erp_docstatus,erp_outstanding_amount,odoo_state')
        .eq('org_id', orgId).eq('id', first.pmoId).single()) as { status: string; erp_docstatus: number; erp_outstanding_amount: number; odoo_state: string | null };
      assertEquals([mirror.status, mirror.erp_docstatus, Number(mirror.erp_outstanding_amount), mirror.odoo_state], ['Unpaid', 1, 1000, 'posted']);
      for (const entry of cases) {
        const matches = await call<number[]>('account.move', 'search', { domain: [['id', '=', entry.moveId]] });
        assertEquals(matches.length, 1, 'recovery keeps exactly one Odoo invoice');
      }
    } finally {
      for (const [key, value] of hostGuardEnv) value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value);
      for (const entry of cases) {
        await sc.from('external_command_outbox').delete().eq('org_id', orgId).eq('id', entry.id);
        await sc.from('external_refs').delete().eq('org_id', orgId).eq('pmo_record_id', entry.pmoId);
        await sc.from('external_refs').delete().eq('org_id', orgId).eq('pmo_record_id', entry.customerId);
        await sc.from('sales_invoices').delete().eq('org_id', orgId).eq('id', entry.pmoId);
        await sc.from('companies').delete().eq('org_id', orgId).eq('id', entry.customerId);
        await call('account.move', 'button_draft', { ids: [entry.moveId] }).catch(() => {});
        await call('account.move', 'unlink', { ids: [entry.moveId] }).catch(() => {});
        await call('res.partner', 'unlink', { ids: [entry.partnerId] }).catch(() => {});
        await call('product.product', 'unlink', { ids: [entry.productId] }).catch(() => {});
      }
      if (actorId) {
        await Promise.resolve(sc.rpc('disconnect_external_integration', {
          p_org_id: orgId, p_external_tier: 'odoo', p_actor_id: actorId,
        })).catch(() => {});
        await sc.auth.admin.deleteUser(actorId).catch(() => {});
      }
      await Promise.resolve(sc.from('organizations').delete().eq('id', orgId).throwOnError()).catch(() => {});
    }
  },
});
