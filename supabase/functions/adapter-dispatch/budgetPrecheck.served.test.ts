/**
 * Issue #1421 — the read-only activation precheck is served by the real adapter-dispatch handler,
 * reuses its ERPNext calendar path, and never enters the money outbox or writes an ERP Budget.
 */
import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';
import {
  createJwtAuthority,
  createTestJwksResolver,
  installEdgeEnv,
  jsonResponse,
  restCall,
  withFetchMock,
} from '../_shared/testing/edgeTestKit.ts';
import {
  installErpCredentials,
  servedRoutes,
  twoYearPhasedSeed,
  USER_ID,
  VERSION_ID,
} from './bfyServedFixture.ts';

const env = installEdgeEnv();
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
const restoreCreds = installErpCredentials();
const auth = await createJwtAuthority(env.SUPABASE_URL);

// The shipped handler, captured from the module's own serve call.
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

async function precheckBudget(): Promise<Response> {
  const jwt = await auth.mintJwt({ sub: USER_ID });
  return await servedHandler!(new Request('http://edge.test/adapter-dispatch', {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'budget-activation-precheck', versionId: VERSION_ID }),
  }));
}

describe('budget activation precheck served contract (issue #1421)', () => {
  it('reports phase and account-map findings together from a Draft and performs no money write', async () => {
    const seed = twoYearPhasedSeed({
      versionStatus: 'Draft',
      lineItems: [
        { id: 'li-1', category: 'Labor', budgeted_amount: '90000.00', fiscal_year: '2026' },
        { id: 'li-2', category: 'Materials', budgeted_amount: '50000.00', fiscal_year: null },
        { id: 'li-3', category: 'Travel', budgeted_amount: '10000.00', fiscal_year: '2027' },
      ],
      categoryMap: [{ category: 'Labor', erp_account: '5100 - Labor - AL' }],
    });
    const { routes, erpBudgets } = servedRoutes(seed);

    const result = await withFetchMock(routes, async ({ calls }) => {
      const response = await precheckBudget();
      return { response, body: await response.json(), calls, erpBudgets };
    });

    assertEquals(result.response.status, 200, JSON.stringify(result.body));
    assertEquals(result.body.status, 'blocked');
    assertEquals(result.body.erpCheck, 'available');
    assert(
      result.body.issues.some((issue: { code: string; categories?: string[] }) =>
        issue.code === 'budget-multi-fiscal-year-unphased' && issue.categories?.includes('Materials')),
    );
    assert(
      result.body.issues.some((issue: { code: string; categories?: string[] }) =>
        issue.code === 'budget-category-unmapped' && issue.categories?.includes('Travel')),
    );
    assertEquals(restCall(result.calls, 'external_command_outbox', 'POST').length, 0);
    assertEquals(result.erpBudgets.length, 0);
  });

  it('allows an unphased single-year native budget with no ERP binding or account map', async () => {
    const { routes } = servedRoutes(twoYearPhasedSeed({
      versionStatus: 'Draft', projectEndDate: '2026-12-31', categoryMap: [],
      lineItems: [{ id: 'li-1', category: 'Labor', budgeted_amount: '100.00', fiscal_year: null }],
    }));
    const nativeRoutes = routes.map((route) => route.pathname === '/rest/v1/external_org_bindings'
      ? { ...route, response: jsonResponse(null) } : route);
    const result = await withFetchMock(nativeRoutes, async ({ calls }) => {
      const response = await precheckBudget();
      return { response, body: await response.json(), calls };
    });
    assertEquals(result.response.status, 200, JSON.stringify(result.body));
    assertEquals(result.body, { status: 'ready', erpCheck: 'not-required', fiscalYearNames: null, issues: [] });
    assertEquals(restCall(result.calls, 'budget_category_account_map', 'GET').length, 0);
    assertEquals(restCall(result.calls, 'external_command_outbox', 'POST').length, 0);
  });

  it('returns ready with ERP Fiscal Year names without creating a push attempt', async () => {
    const { routes, erpBudgets } = servedRoutes(twoYearPhasedSeed({ versionStatus: 'Draft' }));
    const result = await withFetchMock(routes, async ({ calls }) => {
      const response = await precheckBudget();
      return { response, body: await response.json(), calls, erpBudgets };
    });

    assertEquals(result.response.status, 200, JSON.stringify(result.body));
    assertEquals(result.body.status, 'ready');
    assertEquals(result.body.fiscalYearNames, ['2026', '2027']);
    assertEquals(restCall(result.calls, 'external_command_outbox', 'POST').length, 0);
    assertEquals(result.erpBudgets.length, 0);
  });

  it('reports an ERP outage as unavailable instead of claiming the Draft is ready', async () => {
    const seed = twoYearPhasedSeed({ versionStatus: 'Draft' });
    const { routes, erpBudgets } = servedRoutes(seed);
    const offlineRoutes = routes.map((route) => route.pathname === '/api/resource/Fiscal%20Year'
      ? { ...route, response: jsonResponse({ exc: 'unavailable' }, { status: 503 }) }
      : route);
    const result = await withFetchMock(offlineRoutes, async ({ calls }) => {
      const response = await precheckBudget();
      return { response, body: await response.json(), calls, erpBudgets };
    });

    assertEquals(result.response.status, 200, JSON.stringify(result.body));
    assertEquals(result.body.status, 'erp-unavailable');
    assertEquals(result.body.erpCheck, 'unavailable');
    assertEquals(result.body.fiscalYearNames, null);
    assertEquals(restCall(result.calls, 'external_command_outbox', 'POST').length, 0);
    assertEquals(result.erpBudgets.length, 0);
  });
});
