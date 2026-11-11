/**
 * A PMO-only org (no activated ERPNext binding) activates budgets without ERPNext: the served budget push
 * answers a benign skip — never the ERP-tier authorization refusal that made the UI report "ERPNext was
 * not updated" on every activation.
 */
import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';
import {
  createJwtAuthority,
  createTestJwksResolver,
  installEdgeEnv,
  jsonResponse,
  rpcCall,
  restCall,
  supabaseRpc,
  supabaseSelect,
  withFetchMock,
} from '../_shared/testing/edgeTestKit.ts';
import {
  installErpCredentials,
  ORG_ID,
  servedRoutes,
  twoYearPhasedSeed,
  USER_ID,
  VERSION_ID,
} from './bfyServedFixture.ts';

const env = installEdgeEnv();
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
const restoreCreds = installErpCredentials();
const auth = await createJwtAuthority(env.SUPABASE_URL);

let servedHandler: ((req: Request) => Promise<Response>) | null = null;
(Deno as unknown as { serve: (handler: unknown) => unknown }).serve = (handler: unknown) => {
  servedHandler = handler as (req: Request) => Promise<Response>;
  return { finished: Promise.resolve() };
};
const { setTestJwks } = await import('./index.ts');
setTestJwks(createTestJwksResolver(auth));

addEventListener('unload', () => {
  restoreCreds();
  env.restore();
});

async function pushBudget(): Promise<Response> {
  const jwt = await auth.mintJwt({ sub: USER_ID });
  return await servedHandler!(new Request('http://edge.test/adapter-dispatch', {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify({ domain: 'budget', operation: 'create', record: { id: VERSION_ID, erp_doc_kind: 'budget' } }),
  }));
}

describe('budget push for a PMO-only org (issue #1500)', () => {
  it('skips the push with 200 and writes nothing when the org has no activated ERPNext binding', async () => {
    const { routes } = servedRoutes(twoYearPhasedSeed());
    const pmoOnly = [
      supabaseRpc('org_has_active_erpnext_binding', () => jsonResponse(false)),
      supabaseSelect('external_org_bindings', () => jsonResponse(null)),
      ...routes,
    ];
    const result = await withFetchMock(pmoOnly, async ({ calls }) => {
      const response = await pushBudget();
      return { response, body: await response.json(), calls };
    });

    assertEquals(result.response.status, 200, JSON.stringify(result.body));
    assertEquals(result.body.skipped, 'org-not-employing-erpnext');
    assertEquals(restCall(result.calls, 'external_command_outbox', 'POST').length, 0);
    assertEquals(result.calls.filter((call) => !call.url.host.includes('supabase') && !call.url.host.startsWith('127.') && !call.url.host.startsWith('localhost')).length, 0);
  });

  it('reaches the ERP-tier authorization gate when the org has an active ERPNext binding', async () => {
    const { routes } = servedRoutes(twoYearPhasedSeed());
    const gatedRoutes = routes.map((route) => {
      if (route.pathname === '/rest/v1/rpc/actor_authorization_state') {
        return { ...route, response: () => jsonResponse({ role: 'Engineer', active: true }) };
      }
      return route;
    });
    const result = await withFetchMock(gatedRoutes, async ({ calls }) => {
      const response = await pushBudget();
      return { response, body: await response.json(), calls };
    });

    assertEquals(result.response.status, 403, JSON.stringify(result.body));
    assertEquals(result.body.error, 'commit-rejected');
    assertEquals(result.body.message, 'role "Engineer" not authorized for a "budget" money write');
    assertEquals(rpcCall(result.calls, 'org_has_active_erpnext_binding').length, 2);
    assertEquals(rpcCall(result.calls, 'actor_authorization_state').length, 1);
    assertEquals(restCall(result.calls, 'external_command_outbox', 'POST').length, 0);
  });

  it('fails closed at the ERP-tier authorization gate when the binding RPC errors', async () => {
    const { routes } = servedRoutes(twoYearPhasedSeed());
    const failedBindingRead = routes.map((route) => route.pathname === '/rest/v1/rpc/org_has_active_erpnext_binding'
      ? { ...route, response: () => jsonResponse({ code: '57P03', message: 'database unavailable' }, { status: 500 }) }
      : route);
    const result = await withFetchMock(failedBindingRead, async ({ calls }) => {
      const response = await pushBudget();
      return { response, body: await response.json(), calls };
    });

    assertEquals(result.response.status, 403, JSON.stringify(result.body));
    assertEquals(result.body.error, 'commit-rejected');
    assertEquals(result.body.message, `org ${ORG_ID} has no active "erpnext" binding to employ domain "budget"`);
    assertEquals(rpcCall(result.calls, 'org_has_active_erpnext_binding').length, 2);
    assertEquals(restCall(result.calls, 'external_command_outbox', 'POST').length, 0);
  });
});
