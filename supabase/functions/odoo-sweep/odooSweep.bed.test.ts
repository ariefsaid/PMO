/**
 * AC-ODC-023 (layer B) — archive, hard delete and rename on the real Odoo bed, swept into the real local Supabase mirror.
 * Gated on the dependencies, never on CI: ODOO_BED_URL / ODOO_BED_DB / ODOO_BED_KEY (sourced from the bed's untracked env
 * file, never printed) and ODOO_BED_ORG, an org the runner seeded with an activated Odoo binding whose Vault secret is the
 * bed key. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY point at the local stack. The returning-id half is pgTAP (Odoo never
 * reuses an id).
 */
import { assert, assertEquals } from '@std/assert';
import { createClient } from '@supabase/supabase-js';
import { bindCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { sweepOdooOrg } from '../_shared/odooSweep.ts';
import { companyDomain, KIND_SPECS, type DirectoryKind } from '../../../pmo-portal/src/lib/adapterSeam/odoo/kinds.ts';

const BED = Deno.env.get('ODOO_BED_URL');
const ORG = Deno.env.get('ODOO_BED_ORG');
const ready = Boolean(BED && ORG && Deno.env.get('ODOO_BED_DB') && Deno.env.get('ODOO_BED_KEY') && Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));

Deno.test({
  name: 'AC-ODC-023 on the bed: an archived item is inactive, a deleted one tombstoned and kept, a renamed one updated',
  ignore: !ready,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const bed = new URL(BED!);
    Deno.env.set('ERPNEXT_ALLOW_LOCAL_BENCH', '1');
    Deno.env.set('ERPNEXT_LOCAL_BENCH_ORIGINS', bed.origin);
    const sc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
    const odoo = bindCall({ baseUrl: bed.origin, apiKey: Deno.env.get('ODOO_BED_KEY') ?? '', database: Deno.env.get('ODOO_BED_DB') ?? '', fetchImpl: fetch });
    const stamp = Date.now().toString(36);
    const ids = await odoo<number[]>('product.product', 'create', { vals_list: ['keep', 'archive', 'delete'].map((n) => ({ name: `S4 ${n} ${stamp}`, default_code: `S4-${n}-${stamp}` })) });
    const [renamed, archived, deleted] = ids.map(String);
    const mirror = async () => {
      const { data, error } = await sc.from('external_master_records').select('external_id,name,active,tombstoned_at')
        .eq('org_id', ORG!).eq('external_tier', 'odoo').eq('kind', 'product').in('external_id', ids.map(String));
      if (error) throw new Error('mirror read failed');
      return Object.fromEntries((data ?? []).map((r) => [r.external_id, r]));
    };
    try {
      const first = await sweepOdooOrg(sc, ORG!, { maxCalls: 2_000 });
      assert('ok' in first && !first.failed, JSON.stringify(first));
      assertEquals(Object.keys(await mirror()).length, 3);

      await odoo('product.product', 'write', { ids: [Number(archived)], vals: { active: false } });
      await odoo('product.product', 'unlink', { ids: [Number(deleted)] });
      await odoo('product.product', 'write', { ids: [Number(renamed)], vals: { name: `S4 renamed ${stamp}` } });
      // Force the daily census due for products (test-only: the sweep itself never writes a cursor outside its RPCs).
      const { data: wm } = await sc.from('external_sync_watermarks').select('watermark_cursor').eq('org_id', ORG!).eq('external_tier', 'odoo').eq('domain', 'master:product').single();
      const cursor = JSON.parse(wm!.watermark_cursor as string);
      delete cursor.census_done_at;
      await sc.from('external_sync_watermarks').update({ watermark_cursor: JSON.stringify(cursor) }).eq('org_id', ORG!).eq('external_tier', 'odoo').eq('domain', 'master:product');

      const second = await sweepOdooOrg(sc, ORG!, { maxCalls: 2_000 });
      assert('ok' in second && !second.failed, JSON.stringify(second));
      const m = await mirror();
      assertEquals([m[archived].active, m[archived].tombstoned_at], [false, null], 'archived → inactive, not tombstoned');
      assert(m[deleted] && m[deleted].tombstoned_at !== null, 'deleted → tombstoned and still present');
      assertEquals([m[renamed].name, m[renamed].tombstoned_at], [`S4 renamed ${stamp}`, null], 'renamed → new name');
    } finally {
      // The bed is shared: leave none of this run's products behind (the mirror reconciles the
      // deletions on its next daily census, which the AC-ODC-090 test below forces due).
      await odoo('product.product', 'unlink', { ids }).catch(() => {});
    }
  },
});

// AC-ODC-090 (reconciliation half; the rest is AC-ODC-010 + 014 + 023 + 051 + 080): after a full sweep, each kind's active mirror rows
// equal the bed's count under the same company domain, and every linked project's cost account still exists on the bed.
Deno.test({
  name: 'AC-ODC-090 on the bed: per kind, active mirror rows equal the bed count, and every linked project account exists',
  ignore: !ready,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const bed = new URL(BED!);
    Deno.env.set('ERPNEXT_ALLOW_LOCAL_BENCH', '1');
    Deno.env.set('ERPNEXT_LOCAL_BENCH_ORIGINS', bed.origin);
    const sc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
    const odoo = bindCall({ baseUrl: bed.origin, apiKey: Deno.env.get('ODOO_BED_KEY') ?? '', database: Deno.env.get('ODOO_BED_DB') ?? '', fetchImpl: fetch });
    // Deletions on the shared bed are only reconciled by each kind's daily census; a comparison right
    // after an incremental sweep counts ghost rows for records earlier suites deleted (the 2026-11-10
    // "expected 16 active products but mirrored 17"). Force the census due for every compared kind, so
    // this run proves a FULL reconciliation: mirror and bed agree after one sweep.
    for (const kind of ['partner', 'product', 'uom', 'analytic_account', 'account', 'tax', 'journal', 'warehouse'] as DirectoryKind[]) {
      const { data: wm } = await sc.from('external_sync_watermarks').select('watermark_cursor')
        .eq('org_id', ORG!).eq('external_tier', 'odoo').eq('domain', `master:${kind}`).maybeSingle();
      if (!wm?.watermark_cursor) continue;
      const cursor = JSON.parse(wm.watermark_cursor as string) as Record<string, unknown>;
      if (cursor && typeof cursor === 'object' && 'census_done_at' in cursor) delete cursor.census_done_at;
      await sc.from('external_sync_watermarks').update({ watermark_cursor: JSON.stringify(cursor) })
        .eq('org_id', ORG!).eq('external_tier', 'odoo').eq('domain', `master:${kind}`);
    }
    const swept = await sweepOdooOrg(sc, ORG!, { maxCalls: 5_000 });
    assert('ok' in swept && !swept.failed, JSON.stringify(swept));
    const { data: binding } = await sc.from('external_org_bindings').select('config').eq('org_id', ORG!).eq('external_tier', 'odoo').single();
    const companyId = Number((binding!.config as Record<string, unknown>).odoo_company_id);
    assert(Number.isInteger(companyId), 'the org has an activated company');
    for (const kind of ['partner', 'product', 'uom', 'analytic_account', 'account', 'tax', 'journal', 'warehouse'] as DirectoryKind[]) {
      const spec = KIND_SPECS[kind];
      const onBed = await odoo<number>(spec.model, 'search_count', { domain: companyDomain(spec, companyId) });
      const { count } = await sc.from('external_master_records').select('id', { count: 'exact', head: true })
        .eq('org_id', ORG!).eq('external_tier', 'odoo').eq('kind', kind).eq('active', true).is('tombstoned_at', null);
      assertEquals(count, onBed, `${kind}: mirror rows equal the bed's active records`);
    }
    const { data: links } = await sc.from('external_project_bindings').select('external_project_id').eq('org_id', ORG!).eq('external_tier', 'odoo');
    const ids = (links ?? []).map((l) => Number(l.external_project_id));
    if (ids.length) assertEquals(await odoo<number>('account.analytic.account', 'search_count', { domain: [['id', 'in', ids]], context: { active_test: false } }), ids.length, 'every linked project account exists on the bed');
  },
});
