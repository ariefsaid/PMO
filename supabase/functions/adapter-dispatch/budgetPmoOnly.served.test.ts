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
  restCall,
  supabaseRpc,
  supabaseSelect,
  withFetchMock,
} from '../_shared/testing/edgeTestKit.ts';
import { installErpCredentials, servedRoutes, twoYearPhasedSeed, USER_ID, VERSION_ID } from './bfyServedFixture.ts';

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

describe('budget push for a PMO-only org', () => {
  it('skips the push with 200 and writes nothing when the org has no activated ERPNext binding', async () => {
    const { routes } = servedRoutes(twoYearPhasedSeed());
    const pmoOnly = [
      supabaseRpc('org_has_active_erpnext_binding', () => jsonResponse(false)),
      supabaseSelect('external_org_bindings', () => jsonResponse(null)),
      ...routes,
    ];
    const result = await withFetchMock(pmoOnly, async ({ calls }) => {
      const jwt = await auth.mintJwt({ sub: USER_ID });
      const response = await servedHandler!(new Request('http://edge.test/adapter-dispatch', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ domain: 'budget', operation: 'create', record: { id: VERSION_ID, erp_doc_kind: 'budget' } }),
      }));
      return { response, body: await response.json(), calls };
    });

    assertEquals(result.response.status, 200, JSON.stringify(result.body));
    assertEquals(result.body.skipped, 'org-not-employing-erpnext');
    assertEquals(restCall(result.calls, 'external_command_outbox', 'POST').length, 0);
    assertEquals(result.calls.filter((call) => !call.url.host.includes('supabase') && !call.url.host.startsWith('127.') && !call.url.host.startsWith('localhost')).length, 0);
  });
});
