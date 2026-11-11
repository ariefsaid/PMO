import { assert, assertEquals } from '@std/assert';
import { createJwtAuthority, createTestJwksResolver, installEdgeEnv, jsonResponse, withFetchMock } from '../_shared/testing/edgeTestKit.ts';
import { installErpCredentials, servedRoutes, twoYearPhasedSeed, ORG_ID, USER_ID, VERSION_ID } from './bfyServedFixture.ts';

const env = installEdgeEnv();
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
const restoreCreds = installErpCredentials();
const auth = await createJwtAuthority(env.SUPABASE_URL);
let handler: (req: Request) => Promise<Response>;
(Deno as unknown as { serve: (h: unknown) => unknown }).serve = (h) => {
  handler = h as typeof handler;
  return { finished: Promise.resolve() };
};
const { setTestJwks } = await import('./index.ts');
setTestJwks(createTestJwksResolver(auth));
addEventListener('unload', () => { restoreCreds(); env.restore(); });

function request(jwt: string): Request {
  return new Request('http://edge.test/adapter-dispatch', {
    method: 'POST', headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify({ domain: 'budget', operation: 'create', record: { id: VERSION_ID, erp_doc_kind: 'budget' } }),
  });
}

for (const major of [15, 16]) {
  for (const mode of ['returned', 'thrown'] as const) {
    Deno.test(`gate mirror ${major} ${mode} error yields independent scoped recovery signal and original rejection`, async () => {
      const seed = twoYearPhasedSeed({
        fiscalYears: [{ name: '2026', year_start_date: '2026-01-01', year_end_date: '2026-12-31' }],
        lineItems: [{ id: 'li', category: 'Unmapped', budgeted_amount: '10.00', fiscal_year: '2026' }],
        categoryMap: [], projectStartDate: '2026-01-01', projectEndDate: '2026-12-31',
      });
      const { routes } = servedRoutes(seed, major);
      const table = major === 16 ? 'budget_version_account_erp_mirror' : 'budget_version_erp_mirror';
      routes.unshift({ label: 'mirror failure', method: 'POST', pathname: `/rest/v1/${table}`, response: () => {
        if (mode === 'thrown') throw new Error('transport failed');
        return jsonResponse({ code: 'XX000', message: 'write failed' }, { status: 500 });
      } });
      routes.unshift({ label: 'event', method: 'POST', pathname: '/rest/v1/error_events', response: () => jsonResponse([]) });
      const jwt = await auth.mintJwt({ sub: USER_ID });
      const expected = await withFetchMock(servedRoutes(seed, major).routes, async () => {
        const response = await handler(request(jwt));
        return { status: response.status, body: await response.json() };
      });
      await withFetchMock(routes, async ({ calls }) => {
        const response = await handler(request(jwt));
        assertEquals({ status: response.status, body: await response.json() }, expected);
        assertEquals(expected.status, 422);
        const event = calls.find((call) => call.url.pathname === '/rest/v1/error_events');
        assert(event, 'mirror failure must produce a durable independent event');
        assertEquals(event.bodyJson, { fn: 'adapter-dispatch', error_code: 'BUDGET_FAILURE_MIRROR_WRITE_FAILED', context_id: VERSION_ID, org_id: ORG_ID });
      });
    });
  }
}

for (const major of [15, 16]) {
  Deno.test(`post-gate ${major} mirror failure is signaled despite notification failure; replay retries mirror recording`, async () => {
    const seed = twoYearPhasedSeed({
      fiscalYears: [{ name: '2026', year_start_date: '2026-01-01', year_end_date: '2026-12-31' }],
      lineItems: [{ id: 'li', category: 'Labor', budgeted_amount: '10.00', fiscal_year: '2026' }],
      projectStartDate: '2026-01-01', projectEndDate: '2026-12-31',
      ...(major === 16 ? { rejectBudgetAccount: '5100 - Labor - AL' } : { grainByFiscalYear: { '2026': [{ name: 'DESK-BUDGET', docstatus: 1 }] } }),
    });
    const { routes } = servedRoutes(seed, major);
    const table = major === 16 ? 'budget_version_account_erp_mirror' : 'budget_version_erp_mirror';
    let failures = 0;
    routes.unshift({ label: 'failed mirror', method: 'POST', pathname: `/rest/v1/${table}`,
      match: (call) => !Array.isArray(call.bodyJson) && (call.bodyJson as Record<string, unknown>)?.push_state === 'failed',
      response: () => ++failures === 1 ? jsonResponse({ code: 'XX000', message: 'write failed' }, { status: 500 }) : jsonResponse([]),
    });
    routes.unshift({ label: 'notification fails', pathname: '/rest/v1/notifications', response: () => { throw new Error('notification unavailable'); } });
    routes.unshift({ label: 'event', method: 'POST', pathname: '/rest/v1/error_events', response: () => jsonResponse([]) });
    const jwt = await auth.mintJwt({ sub: USER_ID });
    const expected = await withFetchMock(servedRoutes(seed, major).routes, async () => {
      const first = await handler(request(jwt));
      const second = await handler(request(jwt));
      return [{ status: first.status, body: await first.json() }, { status: second.status, body: await second.json() }];
    });
    await withFetchMock(routes, async ({ calls }) => {
      const first = await handler(request(jwt));
      assert(first.status >= 400);
      const firstBody = await first.json();
      assertEquals({ status: first.status, body: firstBody }, expected[0]);
      assertEquals(calls.filter((call) => call.url.pathname === '/rest/v1/error_events').length, 1);
      const mirror = calls.find((call) => call.url.pathname.endsWith(`/${table}`) && !Array.isArray(call.bodyJson) && (call.bodyJson as Record<string, unknown>)?.push_state === 'failed');
      assert(mirror);
      const row = mirror.bodyJson as Record<string, unknown>;
      assertEquals([row.org_id, row.budget_version_id, row.fiscal_year], [ORG_ID, VERSION_ID, '2026']);
      if (major === 16) assertEquals(row.erp_account, '5100 - Labor - AL');
      const second = await handler(request(jwt));
      assert(second.status >= 400);
      assertEquals({ status: second.status, body: await second.json() }, expected[1]);
      assertEquals(failures, 2, 'retry must attempt to record the rejected outcome again');
      assertEquals(calls.filter((call) => call.url.pathname === '/rest/v1/error_events').length, 1);
    });
  });
}

Deno.test('recorder failure reaches secondary error surface without masking gate rejection', async () => {
  const seed = twoYearPhasedSeed({
    fiscalYears: [{ name: '2026', year_start_date: '2026-01-01', year_end_date: '2026-12-31' }],
    lineItems: [{ id: 'li', category: 'Unmapped', budgeted_amount: '10.00', fiscal_year: '2026' }],
    categoryMap: [], projectStartDate: '2026-01-01', projectEndDate: '2026-12-31',
  });
  const { routes } = servedRoutes(seed, 15);
  routes.unshift({ label: 'mirror failure', method: 'POST', pathname: '/rest/v1/budget_version_erp_mirror', response: () => jsonResponse({ message: 'failed' }, { status: 500 }) });
  routes.unshift({ label: 'event failure', method: 'POST', pathname: '/rest/v1/error_events', response: () => jsonResponse({ message: 'failed' }, { status: 500 }) });
  const jwt = await auth.mintJwt({ sub: USER_ID });
  const errors: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { errors.push(args); };
  try {
    await withFetchMock(routes, async () => {
      const response = await handler(request(jwt));
      assertEquals(response.status, 422);
      assertEquals((await response.json()).error, 'commit-rejected');
      assert(errors.some((args) => String(args[0]).includes('ERROR_EVENT_INSERT_FAILED')));
    });
  } finally { console.error = original; }
});

for (const notificationMode of ['no-recipient', 'returned', 'thrown'] as const) {
  Deno.test(`post-gate recovery signal survives ${notificationMode} notification path`, async () => {
    const seed = twoYearPhasedSeed({
      fiscalYears: [{ name: '2026', year_start_date: '2026-01-01', year_end_date: '2026-12-31' }],
      lineItems: [{ id: 'li', category: 'Labor', budgeted_amount: '10.00', fiscal_year: '2026' }],
      projectStartDate: '2026-01-01', projectEndDate: '2026-12-31', rejectBudgetAccount: '5100 - Labor - AL',
    });
    const { routes } = servedRoutes(seed, 16);
    routes.unshift({ label: 'failure mirror', method: 'POST', pathname: '/rest/v1/budget_version_account_erp_mirror',
      match: (call) => !Array.isArray(call.bodyJson) && (call.bodyJson as Record<string, unknown>)?.push_state === 'failed',
      response: () => jsonResponse({ code: 'XX000' }, { status: 500 }),
    });
    if (notificationMode === 'no-recipient') routes.unshift({ label: 'no recipients', method: 'GET', pathname: '/rest/v1/profiles',
      match: (call) => call.url.searchParams.has('role'), response: () => jsonResponse([]) });
    else routes.unshift({ label: 'notification failure', pathname: '/rest/v1/notifications', response: () => {
      if (notificationMode === 'thrown') throw new Error('notification unavailable');
      return jsonResponse({ code: 'XX000' }, { status: 500 });
    } });
    routes.unshift({ label: 'event', method: 'POST', pathname: '/rest/v1/error_events', response: () => jsonResponse([]) });
    const jwt = await auth.mintJwt({ sub: USER_ID });
    await withFetchMock(routes, async ({ calls }) => {
      const response = await handler(request(jwt));
      assert(response.status >= 400);
      assertEquals((await response.json()).error, 'commit-rejected');
      assertEquals(calls.filter((call) => call.url.pathname === '/rest/v1/error_events').length, 1);
      assert(calls.some((call) => call.url.pathname === '/rest/v1/notifications'), 'notification path is exercised');
    });
  });
}

Deno.test('a later retry reattempts the recovery signal after its own write failed', async () => {
  const seed = twoYearPhasedSeed({
    fiscalYears: [{ name: '2026', year_start_date: '2026-01-01', year_end_date: '2026-12-31' }],
    lineItems: [{ id: 'li', category: 'Unmapped', budgeted_amount: '10.00', fiscal_year: '2026' }],
    categoryMap: [], projectStartDate: '2026-01-01', projectEndDate: '2026-12-31',
  });
  const { routes } = servedRoutes(seed, 15);
  routes.unshift({ label: 'mirror failure', method: 'POST', pathname: '/rest/v1/budget_version_erp_mirror', response: () => jsonResponse({ code: 'XX000' }, { status: 500 }) });
  let eventWrites = 0;
  routes.unshift({ label: 'event recovery', method: 'POST', pathname: '/rest/v1/error_events',
    response: () => ++eventWrites === 1 ? jsonResponse({ code: 'XX000' }, { status: 500 }) : jsonResponse([]) });
  const jwt = await auth.mintJwt({ sub: USER_ID });
  await withFetchMock(routes, async ({ calls }) => {
    const first = await handler(request(jwt));
    const second = await handler(request(jwt));
    assertEquals(first.status, 422);
    assertEquals(second.status, 422);
    assertEquals((await first.json()).error, 'commit-rejected');
    assertEquals((await second.json()).error, 'commit-rejected');
    assertEquals(eventWrites, 2);
    assertEquals((calls.filter((call) => call.url.pathname === '/rest/v1/error_events')[1].bodyJson as Record<string, unknown>).context_id, VERSION_ID);
  });
});

Deno.test('an unexpected reporter exception cannot replace the original gate rejection', async () => {
  const seed = twoYearPhasedSeed({
    fiscalYears: [{ name: '2026', year_start_date: '2026-01-01', year_end_date: '2026-12-31' }],
    lineItems: [{ id: 'li', category: 'Unmapped', budgeted_amount: '10.00', fiscal_year: '2026' }],
    categoryMap: [], projectStartDate: '2026-01-01', projectEndDate: '2026-12-31',
  });
  const { routes } = servedRoutes(seed, 15);
  routes.unshift({ label: 'mirror failure', method: 'POST', pathname: '/rest/v1/budget_version_erp_mirror', response: () => jsonResponse({ code: 'XX000' }, { status: 500 }) });
  const jwt = await auth.mintJwt({ sub: USER_ID });
  const original = console.error;
  let threw = false;
  console.error = (...args: unknown[]) => {
    if (String(args[0]).includes('BUDGET_FAILURE_MIRROR_WRITE_FAILED')) { threw = true; throw new Error('reporter failed'); }
  };
  try {
    await withFetchMock(routes, async () => {
      const response = await handler(request(jwt));
      assertEquals(response.status, 422);
      assertEquals((await response.json()).error, 'commit-rejected');
      assert(threw, 'the reporter exception path was exercised');
    });
  } finally { console.error = original; }
});
