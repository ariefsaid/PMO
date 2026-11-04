import { assertEquals } from '@std/assert';
import { describe, it } from '@std/testing/bdd';
import { createJwtAuthority, createTestJwksResolver, installEdgeEnv, withFetchMock } from '../_shared/testing/edgeTestKit.ts';
import {
  installErpCredentials,
  ORG_ID,
  PROJECT_ID,
  servedRoutes,
  USER_ID,
  VERSION_ID,
  type ServedSeed,
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
addEventListener('unload', () => { restoreCreds(); env.restore(); });

const RANGE_CANCEL_INTENT_ID = '66666666-6666-4666-8666-666666666666';

function wholeProjectSeed(): ServedSeed {
  const years = [
    { name: 'FY-26', start: '2026-04-01', end: '2027-03-31' },
    { name: 'FY-27', start: '2027-04-01', end: '2028-03-31' },
  ];
  const projectStart = '2026-06-01';
  const projectEnd = '2028-01-31';
  return {
    fiscalYears: years.map(({ name, start, end }) => ({ name, year_start_date: start, year_end_date: end })),
    lineItems: [{ id: 'li-labor', category: 'Labor', budgeted_amount: '100.01', fiscal_year: null }],
    categoryMap: [{ category: 'Labor', erp_account: '5100 - Labor - AL' }],
    projectStartDate: projectStart,
    projectEndDate: projectEnd,
    budgetMode: 'whole_project' as const,
    distributionPlan: {
      method: 'amount_by_year', inputs: { 'FY-26': '50.01', 'FY-27': '50.00' }, category_overrides: {},
      basis: { projectStart, projectEnd, years },
    },
    distributionRows: [
      { id: 'distribution-1', category: 'Labor', fiscal_year: 'FY-26', ordinal: 0, amount: '50.01', method: 'amount_by_year', is_override: false },
      { id: 'distribution-2', category: 'Labor', fiscal_year: 'FY-27', ordinal: 1, amount: '50.00', method: 'amount_by_year', is_override: false },
    ],
    archiveCancelIntents: [{ id: RANGE_CANCEL_INTENT_ID, state: 'pending' }],
  };
}

describe('AC-BUD-012 whole-project successor cancellation wait', () => {
  it('returns 202 with durable visible pending range units and makes no replacement ERP write', async () => {
    const { routes, accountMirrorRows } = servedRoutes(wholeProjectSeed(), 16);
    const jwt = await auth.mintJwt({ sub: USER_ID });
    const result = await withFetchMock(routes, async ({ calls }) => {
      const response = await servedHandler!(new Request('http://edge.test/adapter-dispatch', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          domain: 'budget', operation: 'create',
          record: { id: VERSION_ID, erp_doc_kind: 'budget' },
        }),
      }));
      return { response, body: await response.json(), calls };
    });

    assertEquals(result.response.status, 202, JSON.stringify(result.body));
    assertEquals(result.body.error, 'budget-cancellation-pending');
    assertEquals(accountMirrorRows.map((row) => ({
      budget_version_id: row.budget_version_id,
      fiscal_year: row.fiscal_year,
      to_fiscal_year: row.to_fiscal_year,
      erp_account: row.erp_account,
      push_state: row.push_state,
      push_error: row.push_error,
    })), [{
      budget_version_id: VERSION_ID,
      fiscal_year: 'FY-26',
      to_fiscal_year: 'FY-27',
      erp_account: '5100 - Labor - AL',
      push_state: 'pending',
      push_error: 'waiting-for-budget-archive-cancellation',
    }]);
    assertEquals(result.calls.filter((call) => call.method === 'POST' && call.url.pathname === '/api/resource/Budget').length, 0);
    assertEquals(result.calls.filter((call) => call.method !== 'GET' && call.url.host === 'erp.bfy.test').length, 0);
    assertEquals(result.calls.filter((call) => call.method === 'POST' && call.url.pathname === '/rest/v1/external_command_outbox').length, 0);
  });

  it('checks cancellations in this org and project before considering the range units', async () => {
    const { routes } = servedRoutes({
      ...wholeProjectSeed(),
      archiveCancelIntents: [
        { id: RANGE_CANCEL_INTENT_ID, state: 'complete' },
        { id: '77777777-7777-4777-8777-777777777777', state: 'pending' },
      ],
    }, 16);
    const jwt = await auth.mintJwt({ sub: USER_ID });
    const result = await withFetchMock(routes, async ({ calls }) => {
      const response = await servedHandler!(new Request('http://edge.test/adapter-dispatch', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ domain: 'budget', operation: 'create', record: { id: VERSION_ID, erp_doc_kind: 'budget' } }),
      }));
      const intentRead = calls.find((call) => call.url.pathname === '/rest/v1/budget_archive_cancel_intents');
      return { response, calls, intentRead };
    });
    assertEquals(result.response.status, 202);
    assertEquals(result.intentRead?.url.searchParams.get('org_id'), `eq.${ORG_ID}`);
    assertEquals(result.intentRead?.url.searchParams.get('project_id'), `eq.${PROJECT_ID}`);
  });

  it('keeps a superseded cancellation pending when an archive outbox command may have reached ERPNext', async () => {
    const seed = wholeProjectSeed();
    seed.archiveCancelIntents = [{ id: RANGE_CANCEL_INTENT_ID, state: 'superseded' }];
    seed.issuedArchiveIntentIds = [RANGE_CANCEL_INTENT_ID];
    const { routes } = servedRoutes(seed, 16);
    const jwt = await auth.mintJwt({ sub: USER_ID });
    const result = await withFetchMock(routes, async ({ calls }) => {
      const response = await servedHandler!(new Request('http://edge.test/adapter-dispatch', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ domain: 'budget', operation: 'create', record: { id: VERSION_ID, erp_doc_kind: 'budget' } }),
      }));
      return { response, body: await response.json(), calls };
    });

    assertEquals(result.response.status, 202, JSON.stringify(result.body));
    assertEquals(result.body.error, 'budget-cancellation-pending');
    const archiveOutboxRead = result.calls.find((call) =>
      call.url.pathname === '/rest/v1/external_command_outbox' && call.url.searchParams.has('payload->>budget_archive_cancel_job_id'));
    assertEquals(archiveOutboxRead?.url.searchParams.get('payload->>budget_archive_cancel_job_id'), `eq.${RANGE_CANCEL_INTENT_ID}`);
    assertEquals(result.calls.filter((call) => call.method === 'POST' && call.url.pathname === '/api/resource/Budget').length, 0);
  });
});
