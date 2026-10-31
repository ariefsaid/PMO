/**
 * FR-ODC-047 — the odoo-sweep tick: the real handler from ./index.ts, Supabase mocked over fetch.
 */
import { afterAll, describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';
import { handleOdooSweepRequest, ODOO_SWEEP_SECRET_ENV } from './index.ts';
import { installEdgeEnv, jsonResponse, rpcCall, supabaseRpc, supabaseSelect, withFetchMock, type FetchCall } from '../_shared/testing/edgeTestKit.ts';

const env = installEdgeEnv();
const SECRET = 'synthetic-sweep-secret';
Deno.env.set(ODOO_SWEEP_SECRET_ENV, SECRET);
afterAll(() => { env.restore(); Deno.env.delete(ODOO_SWEEP_SECRET_ENV); });

async function tick(orgs: { org_id: string }[], authorization = `Bearer ${SECRET}`) {
  const routes = [
    supabaseSelect('external_org_bindings', (c) =>
      // the org list is one query; each org's resolver read carries an org_id filter
      c.url.searchParams.has('org_id') ? jsonResponse([]) : jsonResponse(orgs)),
    // The lock is held elsewhere, so each org stops right after its claim: this suite is about the fan-out.
    supabaseRpc('claim_erp_sweep_lock', () => jsonResponse(false)),
  ];
  return await withFetchMock(routes, async ({ calls }) => {
    const res = await handleOdooSweepRequest(new Request('http://edge.test/odoo-sweep', { method: 'POST', headers: { Authorization: authorization }, body: '{}' }));
    return { res, json: await res.json(), calls };
  });
}
const nonSupabase = (calls: FetchCall[]) => calls.filter((c) => !c.url.host.startsWith('edge-test.supabase'));

describe('odoo-sweep — FR-ODC-047', () => {
  it('a wrong or missing bearer → 401, nothing read', async () => {
    for (const auth of ['Bearer wrong', '', SECRET]) {
      const r = await tick([], auth);
      assertEquals(r.res.status, 401);
      assertEquals(r.calls.length, 0);
    }
  });

  it('no sweep secret configured → 401 even for an empty bearer', async () => {
    Deno.env.delete(ODOO_SWEEP_SECRET_ENV);
    try {
      const r = await tick([], 'Bearer ');
      assertEquals(r.res.status, 401);
    } finally { Deno.env.set(ODOO_SWEEP_SECRET_ENV, SECRET); }
  });

  it('the org list is tier odoo, active and activated only', async () => {
    const r = await tick([]);
    const q = r.calls.find((c) => c.url.pathname === '/rest/v1/external_org_bindings')!.url.searchParams;
    assertEquals([q.get('external_tier'), q.get('status'), q.get('activated_at')], ['eq.odoo', 'eq.active', 'not.is.null']);
  });

  it('AC-ODC-092 no Odoo org (S-B) → 200 {orgs:0} and no Odoo call', async () => {
    const r = await tick([]);
    assertEquals(r.res.status, 200);
    assertEquals(r.json, { orgs: 0, results: [] });
    assertEquals(nonSupabase(r.calls).length, 0);
  });

  it('two orgs → two lock claims, one per org', async () => {
    const r = await tick([{ org_id: 'org-a' }, { org_id: 'org-b' }]);
    assertEquals(r.res.status, 200);
    assertEquals(rpcCall(r.calls, 'claim_erp_sweep_lock').map((c) => (c.bodyJson as { p_org_id: string }).p_org_id), ['org-a', 'org-b']);
    assertEquals(r.json.results, [{ org_id: 'org-a', skipped: 'lock-held' }, { org_id: 'org-b', skipped: 'lock-held' }]);
  });
});
