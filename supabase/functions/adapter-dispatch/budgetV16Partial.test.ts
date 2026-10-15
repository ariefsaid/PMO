import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';
import { createJwtAuthority, createTestJwksResolver, installEdgeEnv, withFetchMock } from '../_shared/testing/edgeTestKit.ts';
import { installErpCredentials, servedRoutes, twoYearPhasedSeed, USER_ID, VERSION_ID } from './bfyServedFixture.ts';
import { budgetAccountIdentity } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/budgetAccountIdentity.ts';

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

function makeRequest(jwt: string, targetFiscalYear?: string) {
  return new Request('http://edge.test/adapter-dispatch', {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify({ domain: 'budget', operation: 'create', record: { id: VERSION_ID, erp_doc_kind: 'budget', ...(targetFiscalYear ? { target_fiscal_year: targetFiscalYear } : {}) } }),
  });
}

describe('v16 account fan-out partial outcome', () => {
  it('records one account failure and continues to create the sibling account', async () => {
    const seed = twoYearPhasedSeed({
      fiscalYears: [{ name: '2026', year_start_date: '2026-01-01', year_end_date: '2026-12-31' }],
      lineItems: [
        { id: 'li-labor', category: 'Labor', budgeted_amount: '50000.00', fiscal_year: '2026' },
        { id: 'li-materials', category: 'Materials', budgeted_amount: '25000.00', fiscal_year: '2026' },
      ],
      projectStartDate: '2026-01-01', projectEndDate: '2026-12-31',
      rejectBudgetAccount: '5100 - Labor - AL',
    });
    const { routes, erpBudgets, accountMirrorRows } = servedRoutes(seed, 16);
    const jwt = await auth.mintJwt({ sub: USER_ID });
    await withFetchMock(routes, async ({ calls }) => {
      const first = await handler!(makeRequest(jwt));
      assert(first.status >= 400, 'the rejected account must surface a failed dispatch');
      assertEquals(erpBudgets.length, 1);
      assertEquals(erpBudgets[0].body.account, '5200 - Materials - AL');
      assertEquals(erpBudgets.some((doc) => doc.body.account === '5200 - Materials - AL'), true);
      assertEquals(accountMirrorRows.find((row) => row.erp_account === '5100 - Labor - AL')?.push_state, 'failed');
      assertEquals(accountMirrorRows.find((row) => row.erp_account === '5100 - Labor - AL')?.push_error, 'commit-rejected');
      assertEquals(accountMirrorRows.find((row) => row.erp_account === '5200 - Materials - AL')?.push_state, 'pushed');
      const postCount = calls.filter((call) => call.method === 'POST' && call.url.pathname === '/api/resource/Budget').length;
      const replay = await handler!(makeRequest(jwt));
      assert(replay.status >= 400);
      assert(replay.status !== 409, 'terminal account replay is not misreported as an in-flight conflict');
      assertEquals(calls.filter((call) => call.method === 'POST' && call.url.pathname === '/api/resource/Budget').length, postCount,
        'replay must not duplicate the successful sibling account');
      assertEquals(accountMirrorRows.find((row) => row.erp_account === '5200 - Materials - AL')?.push_state, 'pushed');
    });
  });

  it('an adapter-select refusal is scoped to its account and the sibling still commits', async () => {
    const seed = twoYearPhasedSeed({
      fiscalYears: [{ name: '2026', year_start_date: '2026-01-01', year_end_date: '2026-12-31' }],
      lineItems: [
        { id: 'li-labor', category: 'Labor', budgeted_amount: '50000.00', fiscal_year: '2026' },
        { id: 'li-materials', category: 'Materials', budgeted_amount: '25000.00', fiscal_year: '2026' },
      ],
      projectStartDate: '2026-01-01', projectEndDate: '2026-12-31',
      grainByAccountYear: { '2026|5100 - Labor - AL': [{ name: 'DESK-LABOR', docstatus: 1 }] },
    });
    const { routes, erpBudgets, accountMirrorRows } = servedRoutes(seed, 16);
    const jwt = await auth.mintJwt({ sub: USER_ID });
    await withFetchMock(routes, async ({ calls }) => {
      const response = await handler!(makeRequest(jwt));
      assert(response.status >= 400);
      assertEquals(erpBudgets.map((doc) => doc.body.account), ['5200 - Materials - AL']);
      const failed = accountMirrorRows.find((row) => row.erp_account === '5100 - Labor - AL');
      assertEquals(failed?.push_state, 'failed');
      assertEquals(failed?.push_error, 'budget-unowned-live-occupant');
      assertEquals(calls.filter((call) => call.method === 'POST' && call.url.pathname === '/api/resource/Budget').length, 1);
      assertEquals(accountMirrorRows.find((row) => row.erp_account === '5200 - Materials - AL')?.push_state, 'pushed');
    });
  });

  it('a year retry dispatches only that year and leaves its confirmed sibling untouched', async () => {
    const seed = twoYearPhasedSeed({
      lineItems: [
        { id: 'li-2026-a', category: 'Labor', budgeted_amount: '50000.00', fiscal_year: '2026' },
        { id: 'li-2026-b', category: 'Materials', budgeted_amount: '25000.00', fiscal_year: '2026' },
        { id: 'li-2027', category: 'Materials', budgeted_amount: '70000.00', fiscal_year: '2027' },
      ],
      projectStartDate: '2026-01-01', projectEndDate: '2027-12-31',
    });
    const { routes, erpBudgets, accountMirrorRows } = servedRoutes(seed, 16);
    const jwt = await auth.mintJwt({ sub: USER_ID });
    await withFetchMock(routes, async ({ calls }) => {
      const response = await handler!(makeRequest(jwt, '2026'));
      assertEquals(response.status, 200, await response.text());
      assertEquals(erpBudgets.length, 2);
      assert(erpBudgets.every((doc) => doc.body.from_fiscal_year === '2026'));
      assertEquals(accountMirrorRows.length, 2);
      const keys = calls.filter((call) => call.method === 'POST' && call.url.pathname.endsWith('/external_command_outbox'));
      assertEquals(keys.length, 2);
      assertEquals(keys.map((call) => String((call.bodyJson as Record<string, unknown>).pmo_record_id)), [
        budgetAccountIdentity(VERSION_ID, '2026', '5100 - Labor - AL'),
        budgetAccountIdentity(VERSION_ID, '2026', '5200 - Materials - AL'),
      ]);
    });
  });
});
