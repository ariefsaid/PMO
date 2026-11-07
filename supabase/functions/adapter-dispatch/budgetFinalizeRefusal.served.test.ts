/**
 * #1364 — a budget push that is refused is RECORDED, never silent.
 *   (a) `record_outbox_ref` refusing a committed row ends the request with a recorded reason (it used to
 *       loop until the function died, leaving nothing).
 *   (b) a push refused before it writes (the project has no start date, so no fiscal year resolves)
 *       leaves a failed mirror row carrying the reason, not "never pushed".
 * Drives the SHIPPED handler with `globalThis.fetch` mocked.
 */
import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';
import { createJwtAuthority, createTestJwksResolver, installEdgeEnv, withFetchMock } from '../_shared/testing/edgeTestKit.ts';
import { installErpCredentials, servedRoutes, twoYearPhasedSeed, USER_ID, VERSION_ID } from './bfyServedFixture.ts';

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

function pushRequest(jwt: string) {
  return new Request('http://edge.test/adapter-dispatch', {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify({ domain: 'budget', operation: 'create', record: { id: VERSION_ID, erp_doc_kind: 'budget' } }),
  });
}

const oneYear = (overrides = {}) => twoYearPhasedSeed({
  fiscalYears: [{ name: '2026', year_start_date: '2026-01-01', year_end_date: '2026-12-31' }],
  lineItems: [{ id: 'li-labor', category: 'Labor', budgeted_amount: '50000.00', fiscal_year: '2026' }],
  projectStartDate: '2026-01-01', projectEndDate: '2026-12-31',
  ...overrides,
});

describe('#1364 recorded refusals', () => {
  it('a record_outbox_ref that keeps refusing ends the request and records why on the account', async () => {
    const fixture = servedRoutes(oneYear({ refuseOutboxRef: true }), 16);
    const jwt = await auth.mintJwt({ sub: USER_ID });
    await withFetchMock(fixture.routes, async ({ calls }) => {
      const res = await handler!(pushRequest(jwt));
      await res.body?.cancel();
      assert(res.status >= 400, `the refusal is surfaced (status ${res.status})`);
      assert(calls.filter((c) => c.url.pathname === '/rest/v1/rpc/record_outbox_ref').length <= 5, 'the finalize is not retried without bound');
      const row = fixture.accountMirrorRows.find((r) => r.erp_account !== '');
      assertEquals(row?.push_state, 'failed');
      assertEquals(row?.push_error, 'outbox-finalize-refused');
    });
  });

  it('a push refused before writing (no project start date) records the reason the screen can name', async () => {
    const fixture = servedRoutes(oneYear({ projectStartDate: null, projectEndDate: null }), 16);
    const jwt = await auth.mintJwt({ sub: USER_ID });
    await withFetchMock(fixture.routes, async () => {
      const res = await handler!(pushRequest(jwt));
      await res.body?.cancel();
      assertEquals(res.status, 422);
      const row = fixture.accountMirrorRows.find((r) => r.erp_account === '');
      assertEquals(row?.push_state, 'failed');
      assertEquals(row?.push_error, 'budget-project-start-date-missing');
    });
  });

  it('fixing the project dates retires the refusal row on the next push', async () => {
    const seed = oneYear({ projectStartDate: null, projectEndDate: null });
    const fixture = servedRoutes(seed, 16);
    const jwt = await auth.mintJwt({ sub: USER_ID });
    await withFetchMock(fixture.routes, async () => {
      await (await handler!(pushRequest(jwt))).body?.cancel();
      assertEquals(fixture.accountMirrorRows.filter((r) => r.fiscal_year === '').length, 1);
      Object.assign(seed, { projectStartDate: '2026-01-01', projectEndDate: '2026-12-31' });
      const res = await handler!(pushRequest(jwt));
      await res.body?.cancel();
      assertEquals(fixture.accountMirrorRows.filter((r) => r.fiscal_year === '').length, 0, 'no stale refusal beside the real outcome');
    });
  });

  it('a later refusal that resolves a year retires the keyless row (no stale reason beside the real one)', async () => {
    const seed = oneYear({ projectStartDate: null, projectEndDate: null });
    const fixture = servedRoutes(seed, 16);
    const jwt = await auth.mintJwt({ sub: USER_ID });
    await withFetchMock(fixture.routes, async () => {
      await (await handler!(pushRequest(jwt))).body?.cancel();
      assertEquals(fixture.accountMirrorRows.filter((r) => r.fiscal_year === '').length, 1);
      // dates fixed, but a line is now phased outside the project's single fiscal year
      Object.assign(seed, {
        projectStartDate: '2026-01-01', projectEndDate: '2026-12-31',
        lineItems: [{ id: 'li-labor', category: 'Labor', budgeted_amount: '50000.00', fiscal_year: '2027' }],
      });
      const res = await handler!(pushRequest(jwt));
      await res.body?.cancel();
      assertEquals(res.status, 422);
      assertEquals(fixture.accountMirrorRows.filter((r) => r.fiscal_year === '').length, 0, 'the keyless row is gone');
      assertEquals(fixture.accountMirrorRows.filter((r) => r.push_error === 'budget-fiscal-year-invalid').length, 1);
    });
  });

  it('v15: the keyless refusal is written, then retired by a later refusal that names a year', async () => {
    const seed = oneYear({ projectStartDate: null, projectEndDate: null });
    const fixture = servedRoutes(seed, 15);
    const jwt = await auth.mintJwt({ sub: USER_ID });
    await withFetchMock(fixture.routes, async () => {
      await (await handler!(pushRequest(jwt))).body?.cancel();
      const keyless = fixture.legacyMirrorRows.filter((r) => r.fiscal_year === '');
      assertEquals(keyless.length, 1);
      assertEquals(keyless[0]?.push_error, 'budget-project-start-date-missing');
      Object.assign(seed, {
        projectStartDate: '2026-01-01', projectEndDate: '2026-12-31',
        lineItems: [{ id: 'li-labor', category: 'Labor', budgeted_amount: '50000.00', fiscal_year: '2027' }],
      });
      await (await handler!(pushRequest(jwt))).body?.cancel();
      assertEquals(fixture.legacyMirrorRows.filter((r) => r.fiscal_year === '').length, 0);
      assertEquals(fixture.legacyMirrorRows.filter((r) => r.fiscal_year === '2026').length, 1);
    });
  });

  it('v15: a push that passes the gate retires the keyless refusal', async () => {
    const seed = oneYear({ projectStartDate: null, projectEndDate: null });
    const fixture = servedRoutes(seed, 15);
    const jwt = await auth.mintJwt({ sub: USER_ID });
    await withFetchMock(fixture.routes, async () => {
      await (await handler!(pushRequest(jwt))).body?.cancel();
      Object.assign(seed, { projectStartDate: '2026-01-01', projectEndDate: '2026-12-31' });
      await (await handler!(pushRequest(jwt))).body?.cancel();
      assertEquals(fixture.legacyMirrorRows.filter((r) => r.fiscal_year === '').length, 0);
    });
  });
});
