import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';
import { createJwtAuthority, createTestJwksResolver, installEdgeEnv, withFetchMock } from '../_shared/testing/edgeTestKit.ts';
import { budgetAccountIdentity } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/budgetAccountIdentity.ts';
import { installErpCredentials, servedRoutes, twoYearPhasedSeed, USER_ID, VERSION_ID } from './bfyServedFixture.ts';

const env = installEdgeEnv();
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
const restoreCreds = installErpCredentials();
const auth = await createJwtAuthority(env.SUPABASE_URL);
let servedHandler: ((req: Request) => Promise<Response>) | null = null;
(Deno as unknown as { serve: (h: unknown) => unknown }).serve = (h: unknown) => {
  servedHandler = h as (req: Request) => Promise<Response>;
  return { finished: Promise.resolve() };
};
const { setTestJwks } = await import('./index.ts');
setTestJwks(createTestJwksResolver(auth));
addEventListener('unload', () => { restoreCreds(); env.restore(); });

describe('v16 binding snapshot', () => {
  it('binding major selects account units and overwrites caller-supplied unit dimensions', async () => {
    const { routes } = servedRoutes(twoYearPhasedSeed(), 16);
    await withFetchMock(routes, async ({ calls }) => {
      const jwt = await auth.mintJwt({ sub: USER_ID });
      const response = await servedHandler!(new Request('http://edge.test/adapter-dispatch', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          domain: 'budget', operation: 'create',
          record: {
            id: VERSION_ID, erp_doc_kind: 'budget', version_major: 15,
            erp_account: 'Forged', outbox_identity: 'Forged', budget_intent: 'remove',
            budget_predecessor: 'Forged',
          },
        }),
      }));
      assertEquals(response.status, 200);
      const inserts = calls.filter((call) => call.method === 'POST' && call.url.pathname.endsWith('/external_command_outbox'));
      const identities = inserts.map((call) => (call.bodyJson as Record<string, unknown>).pmo_record_id);
      assertEquals(identities, [
        budgetAccountIdentity(VERSION_ID, '2026', '5100 - Labor - AL'),
        budgetAccountIdentity(VERSION_ID, '2027', '5200 - Materials - AL'),
      ]);
      for (const call of inserts) {
        const payload = (call.bodyJson as { payload?: Record<string, unknown> }).payload ?? {};
        assert(!JSON.stringify(payload).includes('Forged'));
      }
      const bindingReads = calls.filter((call) => call.url.pathname.endsWith('/external_org_bindings') && call.method === 'GET');
      assert(bindingReads.some((call) => call.url.searchParams.get('select')?.includes('version_major')));
      assert(bindingReads.some((call) => call.url.searchParams.get('select')?.includes('config')));
      assert(bindingReads.some((call) => call.url.searchParams.get('select')?.includes('activated_at')));
    });
  });
});
