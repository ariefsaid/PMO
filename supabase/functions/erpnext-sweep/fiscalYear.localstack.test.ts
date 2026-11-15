/**
 * AC-ECX-040 (#1599 ECX-5) on the local Supabase stack: the shipped sweep loads the real ERPNext binding row
 * (`listEmployingOrgsLive`), runs the fiscal-year pass (`ensureOrgFiscalYearLive`) inside `runErpSweepCycle`, and stores the
 * check through the real `merge_external_org_binding_config`. What the mocked suite cannot show: the RPC's parameter names
 * and merge on the real schema, the company defaults kept beside the check, and the same-day skip read back from the row the
 * database holds. The ERP is the bed-faithful Fiscal Year fake. Gated on the dependency (the local stack), never on CI:
 *   PMO_LOCAL_SUPABASE_URL=http://127.0.0.1:54321 PMO_LOCAL_SERVICE_ROLE_KEY=<local service key from `supabase status`> \
 *     scripts/with-db-lock.sh deno test --allow-env --allow-net --allow-read supabase/functions/erpnext-sweep/fiscalYear.localstack.test.ts
 */
import { assert, assertEquals } from '@std/assert';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { fakeFiscalYearErp, type FakeYear } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/fakeFiscalYearErp.ts';

const URL_ = Deno.env.get('PMO_LOCAL_SUPABASE_URL') ?? '';
const KEY = Deno.env.get('PMO_LOCAL_SERVICE_ROLE_KEY') ?? '';
const READY = Boolean(URL_ && KEY);
if (READY) {
  Deno.env.set('SUPABASE_URL', URL_);
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', KEY);
}
// importing the sweep entry point would start its HTTP server; the other sweep suites stub the serve call the same way
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { runErpSweepCycle, ensureOrgFiscalYearLive, listEmployingOrgsLive, utcDay } = await import('./index.ts');

const COMPANY = 'ECX Probe Co';
const DEC_1 = Date.parse('2026-12-01T09:00:00Z');

async function withBinding(fn: (ctx: { orgId: string; sc: SupabaseClient }) => Promise<void>) {
  const sc = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } }) as SupabaseClient;
  const orgId = crypto.randomUUID();
  const org = await sc.from('organizations').insert({ id: orgId, name: `ECX-5 local ${orgId.slice(0, 8)}` });
  assertEquals(org.error, null);
  const binding = await sc.from('external_org_bindings').insert({
    org_id: orgId, external_tier: 'erpnext', site_url: 'https://erp.example.com', secret_ref: 'local-ref',
    activated_at: '2026-01-01T00:00:00Z', config: { company: COMPANY, default_payable_account: 'Creditors' },
  });
  assertEquals(binding.error, null);
  try {
    await fn({ orgId, sc });
  } finally {
    await sc.from('external_org_bindings').delete().eq('org_id', orgId);
    await sc.from('organizations').delete().eq('id', orgId);
  }
}

function tick(sc: SupabaseClient, orgId: string, erp: ReturnType<typeof fakeFiscalYearErp>, nowMs: number) {
  const settled: string[] = [];
  return runErpSweepCycle({
    listEmployingOrgs: async () => (await listEmployingOrgsLive(sc)).filter((o) => o.orgId === orgId),
    reconcileOrgOutbox: () => Promise.resolve({ errors: [] } as never),
    sweepOrgDoctypes: () => Promise.resolve({ applied: 0 }),
    feedOrgLedgers: () => Promise.resolve({ gl: 0, ple: 0 } as never),
    refreshOrgAccounting: () => Promise.resolve({}),
    ensureOrgFiscalYear: (o) => ensureOrgFiscalYearLive(sc, o, () => Promise.resolve(erp.client), utcDay(nowMs)),
    markFullSweepDone: () => { settled.push('done'); return Promise.resolve(); },
    deferFullSweep: () => { settled.push('deferred'); return Promise.resolve(); },
  }, undefined, 'full').then((r) => ({ ...r, settled }));
}

async function storedConfig(sc: SupabaseClient, orgId: string) {
  const { data, error } = await sc.from('external_org_bindings').select('config').eq('org_id', orgId).eq('external_tier', 'erpnext').single();
  assertEquals(error, null);
  return (data as { config: Record<string, unknown> }).config;
}

const CAL_2026: FakeYear = { name: '2026', start: '2026-01-01', end: '2026-12-31', companies: [] };

Deno.test({
  name: 'AC-ECX-040 on the local stack: the sweep stores the made year on the real binding, keeps the defaults, and skips the rest of the day from the stored row',
  ignore: !READY, sanitizeResources: false, sanitizeOps: false,
  fn: () => withBinding(async ({ orgId, sc }) => {
    const erp = fakeFiscalYearErp([CAL_2026], { companies: [COMPANY] });
    const first = await tick(sc, orgId, erp, DEC_1);
    assertEquals(first.perOrg[0].errors, []);
    assertEquals(first.settled, ['done']);
    assertEquals(await storedConfig(sc, orgId), {
      company: COMPANY, default_payable_account: 'Creditors',
      fiscal_year: { state: 'ready', checked_on: '2026-12-01', company: COMPANY, current: '2026', next: '2027' },
    });
    const before = erp.calls().length;
    assertEquals((await tick(sc, orgId, erp, DEC_1 + 3_600_000)).perOrg[0].errors, []);
    assertEquals(erp.calls().length, before, 'the same day is skipped from the check the database holds');
    assertEquals(erp.writes().length, 1);
  }),
});

Deno.test({
  name: 'AC-ECX-040 on the local stack: a disabled year on the next year\'s dates is stored as the Operator task naming it, and replaces an earlier refusal whole',
  ignore: !READY, sanitizeResources: false, sanitizeOps: false,
  fn: () => withBinding(async ({ orgId, sc }) => {
    // an earlier day's refusal, worded by the ERP
    const prior = await sc.rpc('merge_external_org_binding_config', { p_org_id: orgId, p_external_tier: 'erpnext',
      p_patch: { fiscal_year: { state: 'refused', checked_on: '2026-11-30', company: COMPANY, message: 'older words' } } });
    assertEquals(prior.error, null);
    const erp = fakeFiscalYearErp([CAL_2026, { name: '2027', start: '2027-01-01', end: '2027-12-31', companies: [], disabled: true }], { companies: [COMPANY], version: 16 });
    const r = await tick(sc, orgId, erp, DEC_1);
    assertEquals(r.perOrg[0].errors, []);
    assertEquals(r.settled, ['done']);
    assertEquals(erp.writes(), []);
    const config = await storedConfig(sc, orgId);
    assertEquals(config.fiscal_year, { state: 'needs-operator', checked_on: '2026-12-01', company: COMPANY, reason: 'disabled-year', year: '2027' });
    assertEquals(config.default_payable_account, 'Creditors');
    assert(!JSON.stringify(config).includes('older words'));
  }),
});
