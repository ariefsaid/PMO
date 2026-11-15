/**
 * AC-ECX-040 (#1599 ECX-5) — the shipped sweep keeps the ERP one fiscal year ahead. The sweep entry point is imported; Supabase
 * and the ERP are mocked over fetch. The ERP is the seam's bed-faithful Fiscal Year fake (`erpnext/fakeFiscalYearErp.ts`).
 */
import { afterAll, describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';
import { createClient } from '@supabase/supabase-js';
import { installEdgeEnv, jsonResponse, type MockRoute, rpcCall, supabaseRpc, withFetchMock, type FetchCall } from '../_shared/testing/edgeTestKit.ts';
import { fakeFiscalYearErp, type FakeYear } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/fakeFiscalYearErp.ts';

// importing the sweep entry point would start its HTTP server; the other sweep suites stub the serve call the same way
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { runErpSweepCycle, ensureOrgFiscalYearLive, utcDay } = await import('./index.ts');
const env = installEdgeEnv();
afterAll(() => env.restore());

const HOST = 'erp.example.com';
const COMPANY = 'ECX Probe Co';
const DEC_1 = Date.parse('2026-12-01T09:00:00Z');

function world(seed: FakeYear[], opts: { denyCreate?: boolean } = {}) {
  const fake = fakeFiscalYearErp(seed, { companies: [COMPANY, 'Other Co'], host: HOST });
  if (opts.denyCreate) fake.denyCreate();
  // The binding row as the database holds it; the config merge RPC writes into it.
  const binding = { config: { company: COMPANY } as Record<string, unknown> };
  const routes = [
    supabaseRpc('merge_external_org_binding_config', (call: FetchCall) => {
      const body = call.bodyJson as { p_org_id: string; p_external_tier: string; p_patch: Record<string, unknown> };
      assertEquals([body.p_org_id, body.p_external_tier], ['org-a', 'erpnext']);
      binding.config = { ...binding.config, ...body.p_patch };
      return jsonResponse(null);
    }),
    {
      label: 'erp-fiscal-year', host: HOST, pathname: /^\/api\/resource\/Fiscal%20Year/,
      response: (call: FetchCall) => fake.fetchImpl(call.url.toString(), { method: call.method, ...(call.bodyText ? { body: call.bodyText } : {}) }),
    } satisfies MockRoute,
  ];
  const sc = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const client = { fetchImpl: (...a: Parameters<typeof fetch>) => fetch(...a), apiKey: 'k', apiSecret: 's', baseUrl: `https://${HOST}`, maxRetries: 0 };
  const org = () => ({
    orgId: 'org-a', bindingId: 'binding-a', siteUrl: `https://${HOST}`, secretRef: 'r', company: COMPANY,
    config: structuredClone(binding.config), versionMajor: 15, activatedAt: '2026-01-01T00:00:00Z', ownedDomains: [], lastFullSweepAt: null,
  });
  const tick = (nowMs: number, cadence: 'full' | 'money-only' = 'full') => runErpSweepCycle({
    listEmployingOrgs: () => Promise.resolve([org()]),
    reconcileOrgOutbox: () => Promise.resolve({ errors: [] } as never),
    sweepOrgDoctypes: () => Promise.resolve({ applied: 0 }),
    feedOrgLedgers: () => Promise.resolve({ gl: 0, ple: 0 } as never),
    refreshOrgAccounting: () => Promise.resolve({}),
    ensureOrgFiscalYear: (o) => ensureOrgFiscalYearLive(sc, o, () => Promise.resolve(client), utcDay(nowMs)),
  }, undefined, cadence);
  return { fake, binding, routes, tick };
}

const CAL_2026: FakeYear = { name: '2026', start: '2026-01-01', end: '2026-12-31', companies: [] };

describe('AC-ECX-040 the sweep keeps the ERP one fiscal year ahead', () => {
  it('AC-ECX-040 given the year ends within 45 days and no next year exists, two sweeps leave exactly one next fiscal year', async () => {
    const w = world([CAL_2026]);
    await withFetchMock(w.routes, async ({ calls }) => {
      const first = await w.tick(DEC_1);
      assertEquals(first.perOrg[0].errors, []);
      // the next day's run looks the year up again and writes nothing
      const second = await w.tick(DEC_1 + 86_400_000);
      assertEquals(second.perOrg[0].errors, []);
      assertEquals(w.fake.years().filter((y) => y.start === '2027-01-01').map((y) => [y.name, y.end, y.companies]), [['2027', '2027-12-31', [COMPANY]]]);
      assertEquals(w.fake.writes().length, 1);
      assertEquals(rpcCall(calls, 'merge_external_org_binding_config').length, 2);
    });
    assertEquals(w.binding.config.fiscal_year, { state: 'ready', checked_on: '2026-12-02', current: '2026', next: '2027' });
  });

  it('AC-ECX-040 a second sweep on the same day makes no ERP call', async () => {
    const w = world([CAL_2026]);
    await withFetchMock(w.routes, async ({ calls }) => {
      await w.tick(DEC_1);
      const before = calls.length;
      await w.tick(DEC_1 + 3_600_000);
      assertEquals(calls.length, before);
    });
  });

  it('AC-ECX-040 an existing global next year is used: nothing is created', async () => {
    const w = world([CAL_2026, { name: '2027', start: '2027-01-01', end: '2027-12-31', companies: [] }]);
    await withFetchMock(w.routes, async () => {
      assertEquals((await w.tick(DEC_1)).perOrg[0].errors, []);
    });
    assertEquals(w.fake.writes(), []);
    assertEquals(w.binding.config.fiscal_year, { state: 'ready', checked_on: '2026-12-01', current: '2026', next: '2027' });
  });

  it('AC-ECX-040 a permission refusal is stored as an Operator task, not as a sweep error and not skipped', async () => {
    const w = world([CAL_2026], { denyCreate: true });
    await withFetchMock(w.routes, async () => {
      assertEquals((await w.tick(DEC_1)).perOrg[0].errors, []);
    });
    assertEquals(w.binding.config.fiscal_year, { state: 'needs-operator', checked_on: '2026-12-01', reason: 'missing-role' });
    assertEquals(w.fake.years().map((y) => y.name), ['2026']);
  });

  it('AC-ECX-040 a refusal is stored in the ERP\'s plain words, with no markup', async () => {
    const w = world([{ ...CAL_2026, companies: [COMPANY] }, { name: 'Other 2027', start: '2027-01-01', end: '2027-12-31', companies: ['Other Co'] }]);
    await withFetchMock(w.routes, async () => { await w.tick(DEC_1); });
    const status = w.binding.config.fiscal_year as { state: string; message: string };
    assertEquals(status.state, 'refused');
    assert(/already set in Fiscal Year Other 2027/.test(status.message), status.message);
    assert(!/[<>]/.test(status.message));
  });

  it('AC-ECX-040 an unreachable ERP stores nothing and is reported, so a later tick retries', async () => {
    const w = world([CAL_2026]);
    w.fake.failNextWrite('transport');
    await withFetchMock(w.routes, async () => {
      const r = await w.tick(DEC_1);
      assertEquals(r.perOrg[0].errors.length, 1);
      assert(r.perOrg[0].errors[0].startsWith('fiscal-year:'));
    });
    assertEquals(w.binding.config.fiscal_year, undefined);
  });

  it('AC-ECX-040 a money-only tick does not run it', async () => {
    const w = world([CAL_2026]);
    await withFetchMock(w.routes, async ({ calls }) => {
      await w.tick(DEC_1, 'money-only');
      assertEquals(calls.length, 0);
    });
  });
});
