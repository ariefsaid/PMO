// #1506 O3 C2 (AC-OCI-050, FR-OCI-060/062, DD-OCI-1, DD-OCI-8): invoice-approval separation of duties for an org that employs revenue under
// tier `odoo`, through the SHIPPED handler (`./index.ts`, fetch mocked). The invoice's author and a different approver each approve under their
// own JWT, with a payload that claims another approver. The author is refused `sod-self-approval` 403 (the database rule, answered as a fact by
// the clearance-grant route); the other user passes the gate, and the approver the clearance is granted for is the JWT subject, whatever the
// payload claims. A refused approval leaves no outbox row and no Odoo request. ERPNext answers the author identically. Until the Odoo adapter
// lands (C3) a gate-passing approval is stopped at adapter selection, which releases the clearance.
import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';
import { createJwtAuthority, createTestJwksResolver, installEdgeEnv, withFetchMock } from '../_shared/testing/edgeTestKit.ts';
import type { FetchCall } from '../_shared/testing/edgeTestKit.ts';
import { APPROVER_ID, AUTHOR_ID, ODOO_HOST, revenueRoutes, submitCommand, type World } from './odooRevenueFixtures.ts';

const env = installEdgeEnv();
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
const auth = await createJwtAuthority(env.SUPABASE_URL);

let servedHandler: ((req: Request) => Promise<Response>) | null = null;
(Deno as unknown as { serve: (h: unknown) => unknown }).serve = (h: unknown) => {
  servedHandler = h as (req: Request) => Promise<Response>;
  return { finished: Promise.resolve() };
};
const { setTestJwks } = await import('./index.ts');
setTestJwks(createTestJwksResolver(auth));
addEventListener('unload', () => env.restore());

async function approveAs(caller: string, world: World, command: Record<string, unknown> = submitCommand()) {
  const unexpected: FetchCall[] = [];
  const grants: string[] = [];
  const result = await withFetchMock(revenueRoutes(unexpected, caller, { projectLink: '101', ...world, grants }), async ({ calls }) => {
    const jwt = await auth.mintJwt({ sub: caller });
    const res = await servedHandler!(new Request('http://edge.test/adapter-dispatch', {
      method: 'POST', headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(command),
    }));
    return { status: res.status, body: await res.text(), calls };
  });
  return { ...result, unexpected, grants };
}

const noMoneyPipeline = (r: Awaited<ReturnType<typeof approveAs>>) => {
  assertEquals(r.unexpected.map((c) => `${c.method} ${c.url.pathname}${c.url.search}`), [], 'every read is mocked');
  assertEquals(r.calls.filter((c) => c.url.pathname.includes('external_command_outbox') && c.method !== 'GET').length, 0, 'no outbox row');
  assertEquals(r.calls.filter((c) => c.url.host === ODOO_HOST).length, 0, 'no Odoo request');
};

describe('AC-OCI-050 the invoice-approval SoD gate for a tier-odoo invoice, through the served handler', () => {
  // A payload that claims another approver changes nothing (FR-OCI-062): the verified caller decides.
  const claiming = (who: string) => submitCommand({ approved_by: who, approvedBy: who, author: who, recorded_by: who });

  it('the invoice\'s AUTHOR approving is refused 403 sod-self-approval, whoever the payload names; no outbox row, no Odoo request', async () => {
    const r = await approveAs(AUTHOR_ID, {}, claiming(APPROVER_ID));
    assertEquals([r.status, JSON.parse(r.body)], [403, { error: 'commit-rejected', message: 'sod-self-approval' }]);
    assertEquals(r.grants, [AUTHOR_ID], 'the gate asked about the verified caller');
    noMoneyPipeline(r);
  });

  it('a DIFFERENT user passes the gate: the approver recorded is the JWT subject, whatever the payload claims, and the clearance is released', async () => {
    const r = await approveAs(APPROVER_ID, {}, claiming(AUTHOR_ID));
    assertEquals(r.grants, [APPROVER_ID], 'the clearance is granted for the JWT subject, never the payload\'s approver');
    assertEquals([r.status, JSON.parse(r.body).error], [422, 'config-rejected']);   // stopped at the Odoo adapter (C3), after the gate
    noMoneyPipeline(r);
    assertEquals(r.calls.some((c) => c.url.pathname.endsWith('/rpc/release_sales_invoice_submit_clearance')), true, 'the clearance ends with the dispatch');
  });

  it('ERPNext answers the author identically: the gate is keyed on the command, not the tier', async () => {
    const odoo = await approveAs(AUTHOR_ID, { owns: ['odoo'] });
    const erpnext = await approveAs(AUTHOR_ID, { owns: ['erpnext'] });
    assertEquals([erpnext.status, erpnext.body], [odoo.status, odoo.body]);
    noMoneyPipeline(erpnext);
  });

  it('FR-OCI-061 the roles that may approve are the ERPNext set: an Engineer, Executive or Project Manager is refused 403 before the SoD gate', async () => {
    for (const role of ['Engineer', 'Executive', 'Project Manager']) {
      const r = await approveAs(APPROVER_ID, { role });
      assertEquals([r.status, JSON.parse(r.body).message], [403, `role "${role}" not authorized for a "revenue" money write`]);
      assertEquals(r.grants, [], `${role}: no clearance asked for`);
      noMoneyPipeline(r);
    }
  });
});
