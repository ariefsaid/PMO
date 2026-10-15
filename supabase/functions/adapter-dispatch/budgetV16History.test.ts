import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';
import { createJwtAuthority, createTestJwksResolver, installEdgeEnv, withFetchMock } from '../_shared/testing/edgeTestKit.ts';
import { installErpCredentials, servedRoutes, twoYearPhasedSeed, USER_ID, VERSION_ID, ORG_ID, PROJECT_ID } from './bfyServedFixture.ts';

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

function request(jwt: string, year?: string) {
  return new Request('http://edge.test/adapter-dispatch', {
    method: 'POST', headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify({ domain: 'budget', operation: 'create', record: { id: VERSION_ID, erp_doc_kind: 'budget', ...(year ? { target_fiscal_year: year } : {}) } }),
  });
}

describe('v16 prior account history', () => {
  it('pages the complete project-scoped history and leaves v15 on the legacy read path', async () => {
    const accountMirrorHistory = [
      ...Array.from({ length: 1001 }, (_, index) => ({
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        org_id: ORG_ID, project_id: PROJECT_ID, fiscal_year: '2026', erp_account: '',
        erp_budget_name: null, erp_cancelled_at: null,
      })),
      { id: '10000000-0000-4000-8000-000000000001', org_id: ORG_ID, project_id: 'other-project', fiscal_year: '2026', erp_account: 'Wrong Project', erp_budget_name: 'WRONG-PROJECT', erp_cancelled_at: null },
      { id: '10000000-0000-4000-8000-000000000002', org_id: 'other-org', project_id: PROJECT_ID, fiscal_year: '2026', erp_account: 'Wrong Org', erp_budget_name: 'WRONG-ORG', erp_cancelled_at: null },
    ];
    const seed = twoYearPhasedSeed({ accountMirrorHistory });
    const jwt = await auth.mintJwt({ sub: USER_ID });
    const v16 = servedRoutes(seed, 16);
    await withFetchMock(v16.routes, async ({ calls }) => {
      const response = await handler!(request(jwt));
      assertEquals(response.status, 200, await response.text());
      const reads = calls.filter((call) => call.method === 'GET' && call.url.pathname.endsWith('/budget_version_account_erp_mirror'));
      assertEquals(reads.length, 2, '1001 source rows require a second keyset page');
      assert(reads.every((call) => call.url.searchParams.get('org_id') === `eq.${ORG_ID}`));
      assert(reads.every((call) => call.url.searchParams.get('budget_versions.project_id') === `eq.${PROJECT_ID}`));
      assertEquals(reads[1]?.url.searchParams.get('id'), `gt.${accountMirrorHistory[999]!.id}`);
      const outbox = calls.filter((call) => call.method === 'POST' && call.url.pathname.endsWith('/external_command_outbox'));
      assertEquals(outbox.length, 2, 'wrong-org and wrong-project history must not become account units');
    });

    const v15 = servedRoutes(twoYearPhasedSeed(), 15);
    await withFetchMock(v15.routes, async ({ calls }) => {
      const response = await handler!(request(jwt));
      assertEquals(response.status, 200, await response.text());
      assertEquals(calls.filter((call) => call.url.pathname.endsWith('/budget_version_account_erp_mirror')).length, 0);
    });
  });

  it('allows a valid in-span empty-year retry but refuses prior accounts outside the live span', async () => {
    const seed = twoYearPhasedSeed({
      lineItems: [{ id: 'li-2026', category: 'Labor', budgeted_amount: '100.00', fiscal_year: '2026' }],
      projectStartDate: '2026-01-01', projectEndDate: '2027-12-31',
    });
    const jwt = await auth.mintJwt({ sub: USER_ID });
    const { routes, accountMirrorRows } = servedRoutes(seed, 16);
    await withFetchMock(routes, async ({ calls }) => {
      const response = await handler!(request(jwt, '2026'));
      assertEquals(response.status, 200, await response.text());
      assertEquals(accountMirrorRows.length, 1);
      const retry = await handler!(request(jwt, '2027'));
      assertEquals(retry.status, 200, await retry.text());
      assertEquals(calls.filter((call) => call.method === 'POST' && call.url.pathname.endsWith('/external_command_outbox')).length, 1,
        'empty valid year does not mint a synthetic zero-budget command');
    });

    const outOfSpan = servedRoutes({ ...seed, accountMirrorHistory: [{
      id: '00000000-0000-4000-8000-000000000001', org_id: ORG_ID, project_id: PROJECT_ID,
      fiscal_year: '2025', erp_account: 'Travel', erp_budget_name: 'OLD-TRAVEL', erp_cancelled_at: null,
    }] }, 16);
    await withFetchMock(outOfSpan.routes, async () => {
      const response = await handler!(request(jwt));
      assertEquals(response.status, 422);
      assert((await response.text()).includes('outside the current project span'));
    });
  });
});
