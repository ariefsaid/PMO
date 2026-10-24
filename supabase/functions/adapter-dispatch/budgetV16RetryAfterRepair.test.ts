/**
 * 0379 follow-up — after the one-off repair confirms the account that already reached ERPNext, an operator's
 * Retry sends only the accounts that never did. The confirmed account is recognised as PMO's own submitted
 * Budget (its ref and named mirror row are the witnesses 0379 writes) and replays its confirmed outbox row
 * without a second POST. Drives the SHIPPED handler with `globalThis.fetch` mocked.
 */
import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';
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

const LABOR = '5100 - Labor - AL';
const MATERIALS = '5200 - Materials - AL';

function retryRequest(jwt: string) {
  return new Request('http://edge.test/adapter-dispatch', {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify({ domain: 'budget', operation: 'create', record: { id: VERSION_ID, erp_doc_kind: 'budget', target_fiscal_year: '2026' } }),
  });
}

describe('AC-BV16-010 Retry after the 0379 repair', () => {
  it('sends only the accounts that never reached ERPNext and never re-posts the confirmed one', async () => {
    const seed = twoYearPhasedSeed({
      fiscalYears: [{ name: '2026', year_start_date: '2026-01-01', year_end_date: '2026-12-31' }],
      lineItems: [
        { id: 'li-labor', category: 'Labor', budgeted_amount: '50000.00', fiscal_year: '2026' },
        { id: 'li-materials', category: 'Materials', budgeted_amount: '25000.00', fiscal_year: '2026' },
      ],
      projectStartDate: '2026-01-01', projectEndDate: '2026-12-31',
      // A draft rival on Materials refuses that account before its outbox row, so — as on production — only
      // Labor reaches ERPNext and Materials has no queued command at all.
      grainByAccountYear: { [`2026|${MATERIALS}`]: [{ name: 'BUDGET-DESK-DRAFT', docstatus: 0, amended_from: null, owner: 'desk' }] },
    });
    const { routes, erpBudgets, accountMirrorRows } = servedRoutes(seed, 16);
    const jwt = await auth.mintJwt({ sub: USER_ID });
    await withFetchMock(routes, async ({ calls }) => {
      // The production shape before Retry: Labor's Budget is submitted in ERPNext and confirmed in PMO;
      // Materials never got there.
      await handler!(retryRequest(jwt));
      assertEquals(erpBudgets.map((doc) => doc.body.account), [LABOR]);
      const laborBudget = erpBudgets[0].name;
      seed.externalRefs = { [budgetAccountIdentity(VERSION_ID, '2026', LABOR)]: laborBudget };
      seed.grainByAccountYear = { [`2026|${LABOR}`]: [{ name: laborBudget, docstatus: 1, amended_from: null, owner: 'pmo' }] };
      const postsBefore = calls.filter((call) => call.method === 'POST' && call.url.pathname === '/api/resource/Budget').length;

      const retry = await handler!(retryRequest(jwt));
      assertEquals(retry.status, 200, await retry.text());
      const posts = calls.filter((call) => call.method === 'POST' && call.url.pathname === '/api/resource/Budget').slice(postsBefore);
      assertEquals(posts.map((call) => (call.bodyJson as Record<string, unknown>).account), [MATERIALS],
        'Retry posts the missing account once and never the confirmed one');
      assertEquals(accountMirrorRows.find((row) => row.erp_account === MATERIALS)?.push_state, 'pushed');
      assertEquals(erpBudgets.filter((doc) => doc.body.account === LABOR).length, 1, 'ERPNext still holds exactly one Labor Budget');
    });
  });
});
