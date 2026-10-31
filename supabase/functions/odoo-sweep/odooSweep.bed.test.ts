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

const BED = Deno.env.get('ODOO_BED_URL');
const ORG = Deno.env.get('ODOO_BED_ORG');
const ready = Boolean(BED && ORG && Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));

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
      await odoo('product.product', 'unlink', { ids: [Number(renamed), Number(archived)] }).catch(() => {});
    }
  },
});
