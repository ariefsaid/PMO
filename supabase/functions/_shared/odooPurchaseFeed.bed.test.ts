/**
 * AC-OPP-073 (layer B, #1505 P7) on the stock Odoo bed, into the real local Supabase mirror: a vendor bill PMO holds is read
 * into its mirror row; deleted in Odoo, the census tombstones it (state `deleted`, docstatus 2, kept, not counted in the case's
 * value). The SHIPPED feed pass runs against the real JSON-2 API and the SHIPPED apply / census RPCs. Gated on the dependencies,
 * never on CI: the bed's URL, database and key come from its untracked env file (sourced, never printed), plus the local stack's
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. The test seeds its own throwaway org (activated Odoo binding, procurement employed)
 * and removes it afterwards. All data is synthetic and stamped.
 *   scripts/with-odoo-lock.sh scripts/with-db-lock.sh bash -c 'set -a; . ./.env.odoo.local; set +a; ODOO_BED_URL=http://127.0.0.1:$ODOO_PORT \
 *     ODOO_BED_DB=$ODOO_DB ODOO_BED_KEY=$ODOO_API_KEY ODOO_BED_SUPABASE=1 deno test --allow-env --allow-net --allow-read supabase/functions/_shared/odooPurchaseFeed.bed.test.ts'
 */
import { assert, assertEquals } from '@std/assert';
import { createClient } from '@supabase/supabase-js';
import { bindCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { runPurchasePass } from './odooPurchaseFeed.ts';

const BED = Deno.env.get('ODOO_BED_URL');
const DB = Deno.env.get('ODOO_BED_DB') ?? '';
const KEY = Deno.env.get('ODOO_BED_KEY') ?? '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const ready = Boolean(BED && DB && KEY && SERVICE && Deno.env.get('SUPABASE_URL') && Deno.env.get('ODOO_BED_SUPABASE'));
const budget = () => { let left = 200; return { left: () => left > 0, spend: () => left-- > 0 }; };

Deno.test({
  name: 'AC-OPP-073 on the bed: a bill deleted in Odoo is tombstoned by the census, kept in PMO and no longer counted',
  ignore: !ready,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const odoo = bindCall({ baseUrl: BED!, apiKey: KEY, database: DB, fetchImpl: fetch });
    const sc = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE!, { auth: { persistSession: false, autoRefreshToken: false } });
    const stamp = `P7-${Date.now()}`;
    const orgId = crypto.randomUUID(), caseId = crypto.randomUUID(), billId = crypto.randomUUID();
    const must = async <T>(p: PromiseLike<{ data: T; error: { message: string } | null }>) => { const { data, error } = await p; if (error) throw new Error(error.message); return data; };
    const [company] = await odoo<Array<{ id: number }>>('res.company', 'search_read', { domain: [], fields: ['id'], limit: 1 });
    const [partner] = await odoo<number[]>('res.partner', 'create', { vals_list: [{ name: `${stamp} vendor`, supplier_rank: 1 }] });
    const [move] = await odoo<number[]>('account.move', 'create', { vals_list: [{
      move_type: 'in_invoice', partner_id: partner, invoice_date: '2026-11-01', ref: stamp,
      invoice_line_ids: [[0, 0, { name: `${stamp} line`, quantity: 1, price_unit: 100 }]],
    }] });
    await odoo('account.move', 'action_post', { ids: [move] });
    try {
      await must(sc.from('organizations').insert({ id: orgId, name: `${stamp} org` }).select());
      await must(sc.from('external_org_bindings').insert({ org_id: orgId, external_tier: 'odoo', site_url: 'https://odoo.example.test', secret_ref: stamp, status: 'active', config: { odoo_company_id: company.id }, activated_at: new Date().toISOString() }).select());
      await must(sc.from('external_domain_ownership').insert({ org_id: orgId, external_tier: 'odoo', domain: 'procurement' }).select());
      await must(sc.from('procurements').insert({ id: caseId, org_id: orgId, title: stamp, currency: 'IDR', total_value: 0, status: 'Draft' }).select());
      await must(sc.from('procurement_invoices').insert({ id: billId, org_id: orgId, procurement_id: caseId, status: 'Received', amount: 100, currency: 'IDR', tax_treatment: 'inclusive', tax_amount: 0 }).select());
      await must(sc.from('external_refs').insert({ org_id: orgId, domain: 'procurement', pmo_record_id: billId, external_tier: 'odoo', external_record_id: `account.move:${move}` }).select());
      const mirror = async () => (await must(sc.from('procurement_invoices').select('erp_state,erp_docstatus,erp_cancelled_at,amount').eq('org_id', orgId).eq('id', billId).single())) as { erp_state: string | null; erp_docstatus: number | null; erp_cancelled_at: string | null; amount: number };

      await runPurchasePass(sc, orgId, 'bill', odoo, company.id, budget());
      const read = await mirror();
      assertEquals([read.erp_state, read.erp_docstatus, read.erp_cancelled_at], ['posted', 1, null], 'the bill PMO holds is read from Odoo');
      const total = async () => Number((await must(sc.rpc('procurement_document_total', { p_procurement_id: caseId }))) as unknown as string);
      assertEquals(await total(), 100, 'a live bill counts');

      await odoo('account.move', 'button_draft', { ids: [move] });
      await odoo('account.move', 'unlink', { ids: [move] });
      // The census is due daily: make it due now (test-only; the sweep itself never writes a cursor outside its RPCs).
      const { data: wm } = await sc.from('external_sync_watermarks').select('watermark_cursor').eq('org_id', orgId).eq('external_tier', 'odoo').eq('domain', 'purchase:bill').single();
      const cursor = JSON.parse(wm!.watermark_cursor as string);
      delete cursor.census_done_at;
      await sc.from('external_sync_watermarks').update({ watermark_cursor: JSON.stringify(cursor) }).eq('org_id', orgId).eq('external_tier', 'odoo').eq('domain', 'purchase:bill');
      // ref link time must precede the census run; it was created above, before this pass
      await runPurchasePass(sc, orgId, 'bill', odoo, company.id, budget());
      const gone = await mirror();
      assertEquals([gone.erp_state, gone.erp_docstatus], ['deleted', 2], 'the deleted bill is tombstoned, not removed');
      assert(gone.erp_cancelled_at !== null);
      assertEquals(await total(), 0, 'a tombstoned bill is not counted in the case value');
    } finally {
      // procurements do not cascade from the org, so the case rows go first
      for (const t of ['procurement_invoices', 'procurements']) await sc.from(t).delete().eq('org_id', orgId);
      await sc.from('organizations').delete().eq('id', orgId);
      await odoo('account.move', 'unlink', { ids: [move] }).catch(() => {});
    }
  },
});
