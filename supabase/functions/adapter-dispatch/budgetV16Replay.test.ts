import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';
import { createJwtAuthority, createTestJwksResolver, installEdgeEnv, withFetchMock } from '../_shared/testing/edgeTestKit.ts';
import { budgetAccountIdentity, budgetAccountPushKey } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/budgetAccountIdentity.ts';
import { ACTIVATED_AT, installErpCredentials, servedRoutes, twoYearPhasedSeed, USER_ID, VERSION_ID } from './bfyServedFixture.ts';

const env = installEdgeEnv();
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
const restoreCreds = installErpCredentials();
const auth = await createJwtAuthority(env.SUPABASE_URL);
let handler: ((req: Request) => Promise<Response>) | null = null;
(Deno as unknown as { serve: (h: unknown) => unknown }).serve = (h: unknown) => {
  handler = h as (req: Request) => Promise<Response>;
  return { finished: Promise.resolve() };
};
const { setTestJwks } = await import('./index.ts');
setTestJwks(createTestJwksResolver(auth));
addEventListener('unload', () => { restoreCreds(); env.restore(); });

function budgetPosts(calls: Array<{ method: string; url: URL }>): number {
  return calls.filter((call) => call.method === 'POST' && call.url.pathname === '/api/resource/Budget').length;
}

describe('AC-BV16-004', () => {
  it('AC-BV16-004 two account creates once across two real-handler pushes', async () => {
    const seed = twoYearPhasedSeed({
      fiscalYears: [{ name: '2026', year_start_date: '2026-01-01', year_end_date: '2026-12-31' }],
      lineItems: [
        { id: 'li-labor', category: 'Labor', budgeted_amount: '50000.00', fiscal_year: '2026' },
        { id: 'li-materials', category: 'Materials', budgeted_amount: '25000.00', fiscal_year: '2026' },
      ],
      projectStartDate: '2026-01-01', projectEndDate: '2026-12-31',
    });
    const { routes, erpBudgets, accountMirrorRows } = servedRoutes(seed, 16);
    const jwt = await auth.mintJwt({ sub: USER_ID });
    const request = () => new Request('http://edge.test/adapter-dispatch', {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({ domain: 'budget', operation: 'create', record: { id: VERSION_ID, erp_doc_kind: 'budget' } }),
    });
    await withFetchMock(routes, async ({ calls }) => {
      const first = await handler!(request());
      assertEquals(first.status, 200, await first.text());
      const firstPostCount = budgetPosts(calls);
      const firstPutCount = calls.filter((call) => call.method === 'PUT' && call.url.pathname.includes('/api/resource/Budget/')).length;
      assertEquals(firstPostCount, 2);
      const outboxInserts = calls.filter((call) => call.method === 'POST' && call.url.pathname.endsWith('/external_command_outbox'));
      const identities = outboxInserts.map((call) => (call.bodyJson as Record<string, unknown>).pmo_record_id);
      const keys = outboxInserts.map((call) => (call.bodyJson as Record<string, unknown>).idempotency_key);
      assertEquals(accountMirrorRows.map((row) => row.budget_version_id), [VERSION_ID, VERSION_ID],
        'both account mirror rows retain the bare budget-version id');
      assertEquals(identities, [
        budgetAccountIdentity(VERSION_ID, '2026', '5100 - Labor - AL'),
        budgetAccountIdentity(VERSION_ID, '2026', '5200 - Materials - AL'),
      ]);
      assertEquals(keys, identities.map((identity) => budgetAccountPushKey(String(identity), ACTIVATED_AT)));
      assertEquals(new Set(keys).size, 2);

      const second = await handler!(request());
      assertEquals(second.status, 200, await second.text());
      assertEquals(budgetPosts(calls), firstPostCount, 'replay must not create ERP documents');
      assertEquals(calls.filter((call) => call.method === 'PUT' && call.url.pathname.includes('/api/resource/Budget/')).length, firstPutCount, 'replay must not amend ERP documents');
      assertEquals(erpBudgets.length, 2);
      assert(erpBudgets.every((doc) => doc.docstatus === 1));
      assertEquals(erpBudgets.map((doc) => doc.body.account), ['5100 - Labor - AL', '5200 - Materials - AL']);
    });
  });
});
