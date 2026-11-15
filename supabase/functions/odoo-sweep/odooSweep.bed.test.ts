/**
 * AC-ODC-023 (layer B) — archive, hard delete and rename on the real Odoo bed, swept into the real local Supabase mirror.
 * Gated on the dependencies, never on CI: ODOO_BED_URL / ODOO_BED_DB / ODOO_BED_KEY (sourced from the bed's untracked env
 * file, never printed) and ODOO_BED_ORG, an org the runner seeded with an activated Odoo binding whose Vault secret is the
 * bed key. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY point at the local stack. The returning-id half is pgTAP (Odoo never
 * reuses an id).
 */
import { assert, assertEquals } from '@std/assert';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { bindCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { discoverCapabilities } from '../../../pmo-portal/src/lib/adapterSeam/odoo/discovery.ts';
import { sweepOdooOrg } from '../_shared/odooSweep.ts';
import { companyDomain, KIND_SPECS, type DirectoryKind } from '../../../pmo-portal/src/lib/adapterSeam/odoo/kinds.ts';

const BED = Deno.env.get('ODOO_BED_URL');
const DB = Deno.env.get('ODOO_BED_DB');
const KEY = Deno.env.get('ODOO_BED_KEY');
const ORG = Deno.env.get('ODOO_BED_ORG');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const BED_CONFIGURED = Boolean(BED || DB || KEY);

function isLoopback(value: string | undefined): boolean {
  if (!value) return false;
  try {
    return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}

if (BED_CONFIGURED && !(BED && DB && KEY && isLoopback(BED))) {
  throw new Error('Odoo bed tests require the complete local bed context.');
}
if (BED_CONFIGURED && !(SUPABASE_URL && isLoopback(SUPABASE_URL) && SERVICE_ROLE_KEY)) {
  throw new Error('Odoo bed tests require the local Supabase URL and service key.');
}

const bedReady = Boolean(BED_CONFIGURED && BED && DB && KEY && SUPABASE_URL && SERVICE_ROLE_KEY);
const seededOrgReady = Boolean(bedReady && ORG);

type BedFixture = {
  orgId: string;
  actorId: string;
  companyId: number;
  call: ReturnType<typeof bindCall>;
  cleanup: () => Promise<void>;
};

async function provisionBedFixture(sc: SupabaseClient<any>): Promise<BedFixture> {
  const bed = new URL(BED!);
  const raw = bindCall({ baseUrl: bed.origin, apiKey: KEY!, database: DB!, fetchImpl: fetch });
  const companies = await raw<Array<{ id: number; name: string; currency_id?: [number, string] }>>('res.company', 'search_read', {
    domain: [], fields: ['id', 'name', 'currency_id'], order: 'id asc',
  });
  const company = companies.find((candidate) => candidate.currency_id?.[1] === 'IDR') ?? companies[0];
  if (!company) throw new Error('The local Odoo bed has no company.');
  const call = (async <T>(model: string, method: string, body: Record<string, unknown> = {}) =>
    raw<T>(model, method, { ...body, context: { allowed_company_ids: [company.id], company_id: company.id, ...((body.context as object) ?? {}) } })) as typeof raw;

  const orgId = crypto.randomUUID();
  const stamp = `odoo-bed-2177-${crypto.randomUUID()}`;
  const email = `${stamp}@example.test`;
  const password = `${crypto.randomUUID()}Aa1!`;
  const secretRef = stamp;
  let actorId = '';
  let bindingStaged = false;
  const ensure = async (label: string, result: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await result;
    if (error) throw new Error(`${label} failed`);
  };
  const deleteOrgRows = async (table: string) => {
    const result = await (sc.from(table as never) as unknown as {
      delete: () => { eq: (column: string, value: string) => PromiseLike<{ error: { message: string } | null }> };
    }).delete().eq('org_id', orgId);
    if (result.error) throw new Error('Could not clean up the local Odoo test fixture.');
  };
  const cleanup = async () => {
    if (bindingStaged && actorId) {
      const { error } = await sc.rpc('disconnect_external_integration', { p_org_id: orgId, p_external_tier: 'odoo', p_actor_id: actorId });
      if (error) throw new Error('Could not remove the local Odoo test secret.');
    }
    for (const table of ['external_project_bindings', 'external_sync_watermarks', 'external_master_records', 'external_domain_ownership', 'external_org_bindings', 'projects']) {
      await deleteOrgRows(table);
    }
    if (actorId) {
      await ensure('profile cleanup', sc.from('profiles').delete().eq('id', actorId));
      const { error } = await sc.auth.admin.deleteUser(actorId);
      if (error) throw new Error('Could not clean up the local Odoo test actor.');
    }
    await ensure('organization cleanup', sc.from('organizations').delete().eq('id', orgId));
  };

  try {
    await ensure('organization setup', sc.from('organizations').insert({
      id: orgId, name: `${stamp} organization`, default_currency: company.currency_id?.[1] ?? 'IDR', lifecycle_state: 'test',
    }));
    const created = await sc.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error('Could not create the local Odoo test actor.');
    actorId = created.data.user.id;
    await ensure('profile setup', sc.from('profiles').insert({
      id: actorId, org_id: orgId, full_name: `${stamp} Admin`, email, role: 'Admin', status: 'active', locale: 'en', timezone: 'UTC',
    }));
    const enabled = await sc.rpc('service_feature_enabled', { p_org_id: orgId, p_key: 'erp_sync' });
    if (enabled.error || enabled.data !== true) throw new Error('The local Odoo test org does not resolve the ERP feature.');
    await ensure('secret staging', sc.rpc('stage_vault_secret_for_org', {
      p_org_id: orgId, p_external_tier: 'odoo', p_secret_value: KEY!, p_secret_name: secretRef, p_actor_id: actorId,
    }));
    bindingStaged = true;
    await ensure('connection setup', sc.rpc('finalize_odoo_connect', {
      p_org_id: orgId, p_secret_ref: secretRef, p_site_url: bed.origin, p_database: DB!,
      p_key_expires_on: new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10), p_discard: false,
      p_kill_switch_enabled: true, p_actor_id: actorId,
    }));
    const capabilities = await discoverCapabilities(call, { versionMajor: 20, now: new Date() });
    await ensure('company activation', sc.rpc('activate_odoo_binding', {
      p_org_id: orgId, p_version_major: 20, p_company_id: company.id, p_company_name: company.name,
      p_config_patch: { capabilities }, p_actor_id: actorId,
    }));
    return { orgId, actorId, companyId: company.id, call, cleanup };
  } catch (error) {
    try {
      await cleanup();
    } catch {
      throw new AggregateError([error], 'Local Odoo fixture setup and cleanup both failed.');
    }
    throw error;
  }
}

Deno.test({
  name: 'AC-ODC-023 on the bed: an archived item is inactive, a deleted one tombstoned and kept, a renamed one updated',
  ignore: !seededOrgReady,
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
  ignore: !bedReady,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const bed = new URL(BED!);
    Deno.env.set('ERPNEXT_ALLOW_LOCAL_BENCH', '1');
    Deno.env.set('ERPNEXT_LOCAL_BENCH_ORIGINS', bed.origin);
    const sc = createClient<any>(SUPABASE_URL!, SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const fixture = await provisionBedFixture(sc);
    const stamp = crypto.randomUUID();
    const made: Array<[string, number]> = [];
    try {
      const plan = (await fixture.call<number[]>('account.analytic.plan', 'create', { vals_list: [{ name: `Odoo bed 2177 ${stamp}` }] }))[0];
      made.push(['account.analytic.plan', plan]);
      const account = (await fixture.call<number[]>('account.analytic.account', 'create', {
        vals_list: [{ name: `Odoo bed 2177 ${stamp} cost account`, code: `OD2177-${stamp.slice(0, 8)}`, plan_id: plan }],
      }))[0];
      made.push(['account.analytic.account', account]);
      const projectId = crypto.randomUUID();
      const projectNumber = `OD2177-${stamp}`;
      const project = await sc.from('projects').insert({
        id: projectId, org_id: fixture.orgId, code: projectNumber, pmo_project_number: projectNumber,
        name: `Odoo bed 2177 ${stamp} project`, status: 'Ongoing Project',
      }).select('id').single();
      if (project.error) throw new Error('Could not create the local Odoo test project.');
      // Deletions on the shared bed are only reconciled by each kind's daily census; a comparison right
      // after an incremental sweep counts ghost rows left by earlier journeys. A new org has no cursors,
      // so its first sweep naturally runs the full census and proves reconciliation on a dirty bed.
      const swept = await sweepOdooOrg(sc, fixture.orgId, { maxCalls: 5_000 });
      assert('ok' in swept && !swept.failed, JSON.stringify(swept));
      const selectedPlan = await sc.rpc('set_odoo_analytic_plan', { p_org_id: fixture.orgId, p_actor_id: fixture.actorId, p_plan_id: String(plan) });
      if (selectedPlan.error) throw new Error('Could not select the local Odoo test plan.');
      for (const kind of ['partner', 'product', 'uom', 'analytic_account', 'account', 'tax', 'journal', 'warehouse'] as DirectoryKind[]) {
        const spec = KIND_SPECS[kind];
        const onBed = await fixture.call<number>(spec.model, 'search_count', { domain: companyDomain(spec, fixture.companyId) });
        const { count, error } = await sc.from('external_master_records').select('id', { count: 'exact', head: true })
          .eq('org_id', fixture.orgId).eq('external_tier', 'odoo').eq('kind', kind).eq('active', true).is('tombstoned_at', null);
        if (error) throw new Error(`Could not read the local ${kind} mirror count.`);
        assertEquals(count, onBed, `${kind}: mirror rows equal the bed's active records`);
      }

      const linked = await sc.rpc('link_odoo_cost_account', {
        p_org_id: fixture.orgId, p_actor_id: fixture.actorId, p_project_id: projectId, p_account_id: String(account),
      });
      if (linked.error) throw new Error('Could not link the local Odoo test project to its cost account.');
      const { data: links, error: linksError } = await sc.from('external_project_bindings').select('external_container_id')
        .eq('org_id', fixture.orgId).eq('external_tier', 'odoo');
      if (linksError) throw new Error('Could not read the local Odoo test project link.');
      const ids = (links ?? []).map((link) => Number(link.external_container_id));
      assertEquals(ids, [account], 'the fixture contributes one linked project cost account');
      assertEquals(await fixture.call<number>('account.analytic.account', 'search_count', {
        domain: [['id', 'in', ids]], context: { active_test: false },
      }), ids.length, 'every linked project account exists on the bed');
    } finally {
      for (const [model, id] of made.reverse()) await fixture.call(model, 'unlink', { ids: [id] });
      await fixture.cleanup();
    }
  },
});
