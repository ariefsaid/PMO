/**
 * #1371 — the v15 (per-year) mirror of AC-BV16-010's Retry-after-repair tests.
 *
 * The #1370 fix is shared code — the fan-out strips `target_fiscal_year` from EVERY budget unit
 * (`budgetDispatch.ts`) and `erpMoneyOutbox.ts` accepts the pre-#1370 Retry digest for EVERY version —
 * but its #1370 tests only drove a v16 (account-grained) binding. On v15 the shape differs in every
 * dimension the fix touches: one unit per PHASED YEAR (identity `<vid>:<encoded-fy>`, key
 * `bud:<vid>:<encoded-fy>:<epoch>`), the ERP grain is the fiscal year (no account), and the operator
 * surface is `budget_version_erp_mirror`, not the account queue. So v15 gets its own three tests:
 * the Retry that names the year converges a confirmed row its own activation wrote; a row the sweep
 * parked held comes back to pushed with no ERP write; and a row an earlier Retry stored with the year
 * still inside the command is accepted as the same command. Drives the SHIPPED handler with
 * `globalThis.fetch` mocked.
 */
import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';
import { createJwtAuthority, createTestJwksResolver, installEdgeEnv, withFetchMock, type FetchCall } from '../_shared/testing/edgeTestKit.ts';
import { installErpCredentials, servedRoutes, twoYearPhasedSeed, USER_ID, VERSION_ID } from './bfyServedFixture.ts';
import { canonicalCommandDigest } from './moneyOutboxDeps.ts';
import { encodeFiscalYear } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/fiscalYearEncoding.ts';

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

const RETRY_YEAR = '2026';

/** The budget push as `db/budgets.ts` sends it: activation names no year, the operator's Retry names one. */
function pushRequest(jwt: string, targetFiscalYear?: string) {
  const record: Record<string, unknown> = { id: VERSION_ID, erp_doc_kind: 'budget' };
  if (targetFiscalYear) record.target_fiscal_year = targetFiscalYear;
  return new Request('http://edge.test/adapter-dispatch', {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify({ domain: 'budget', operation: 'create', record }),
  });
}

const budgetPosts = (calls: FetchCall[]) => calls.filter((call) => call.method === 'POST' && call.url.pathname === '/api/resource/Budget');
const yearIdentity = `${VERSION_ID}:${encodeFiscalYear(RETRY_YEAR)}`;

/**
 * Activation pushes 2026 (2027 is refused by a Desk draft rival on the fiscal-year grain, before its
 * outbox row — as on production, where the operator's first push only ever lands part of the plan),
 * then the state a repair leaves behind: 2026's outbox row `confirmed` with its saved canonical, its
 * ref recorded, and the live ERP Budget on the grain.
 */
async function activateThenRepair(
  jwt: string,
  calls: FetchCall[],
  fixture: ReturnType<typeof servedRoutes>,
  seed: ReturnType<typeof twoYearPhasedSeed>,
) {
  const activation = await handler!(pushRequest(jwt));
  await activation.body?.cancel();
  assertEquals(fixture.erpBudgets.map((doc) => doc.body.fiscal_year), [RETRY_YEAR],
    'activation pushes only the year whose grain is free; the Desk draft refuses 2027');
  const yearBudget = fixture.erpBudgets[0].name;
  const outbox = [...fixture.outboxRows.values()].find((row) => row.pmo_record_id === yearIdentity)!;
  Object.assign(outbox, {
    state: 'confirmed',
    external_record_id: yearBudget,
    canonical: { id: VERSION_ID, fiscal_year: RETRY_YEAR, erp_budget_name: yearBudget, erp_docstatus: 1 },
  });
  seed.externalRefs = { [yearIdentity]: yearBudget };
  seed.grainByFiscalYear = {
    [RETRY_YEAR]: [{ name: yearBudget, docstatus: 1, amended_from: null, owner: 'pmo' }],
    '2027': [{ name: 'BUDGET-DESK-DRAFT', docstatus: 0, amended_from: null, owner: 'desk' }],
  };
  const insert = calls.find((call) => call.method === 'POST' && call.url.pathname === '/rest/v1/external_command_outbox' &&
    (call.bodyJson as { pmo_record_id?: unknown }).pmo_record_id === yearIdentity)!;
  const savedPayload = (insert.bodyJson as { payload: Record<string, unknown> }).payload;
  return { yearBudget, outbox, savedPayload };
}

/** Two phased years (the plan the activation fans out over), 2027's grain occupied by a Desk draft. */
function freshSeed() {
  return twoYearPhasedSeed({
    grainByFiscalYear: { '2027': [{ name: 'BUDGET-DESK-DRAFT', docstatus: 0, amended_from: null, owner: 'desk' }] },
  });
}

describe('AC-BV15 Retry after the repair (the v15 mirror of AC-BV16-010)', () => {
  it('leaves the already-pushed year pushed and never re-posts it on a Retry that names the year', async () => {
    const seed = freshSeed();
    const fixture = servedRoutes(seed, 15);
    const jwt = await auth.mintJwt({ sub: USER_ID });
    await withFetchMock(fixture.routes, async ({ calls }) => {
      const { yearBudget } = await activateThenRepair(jwt, calls, fixture, seed);
      const postsBefore = budgetPosts(calls).length;

      const retry = await handler!(pushRequest(jwt, RETRY_YEAR));
      const body = await retry.json() as { years?: Array<Record<string, unknown>> };
      assertEquals(retry.status, 200, JSON.stringify(body));
      assertEquals(body.years, [{ fiscal_year: RETRY_YEAR, pushed: true }],
        'the Retry drives exactly the year the operator named');
      assertEquals(budgetPosts(calls).slice(postsBefore).length, 0,
        'the confirmed year converges from its outbox row, never a second Budget POST');
      const yearRow = fixture.budgetMirrorRows.find((row) => row.fiscal_year === RETRY_YEAR);
      assertEquals(yearRow?.push_state, 'pushed', `push_error: ${String(yearRow?.push_error)}`);
      assertEquals(yearRow?.erp_budget_name, yearBudget);
      assertEquals(fixture.budgetMirrorRows.find((row) => row.fiscal_year === '2027')?.push_state, 'failed',
        'the Retry never widens to the year the Desk draft refuses');
      assertEquals(fixture.erpBudgets.filter((doc) => doc.body.fiscal_year === RETRY_YEAR).length, 1,
        'ERPNext still holds exactly one 2026 Budget');
    });
  });

  it('turns a year the sweep parked held back to pushed on one Retry, with no ERPNext write', async () => {
    const seed = freshSeed();
    const fixture = servedRoutes(seed, 15);
    const jwt = await auth.mintJwt({ sub: USER_ID });
    await withFetchMock(fixture.routes, async ({ calls }) => {
      const { yearBudget } = await activateThenRepair(jwt, calls, fixture, seed);
      const yearRow = fixture.budgetMirrorRows.find((row) => row.fiscal_year === RETRY_YEAR)!;
      Object.assign(yearRow, { push_state: 'held', push_error: 'budget-push-attempts-exhausted' });
      const postsBefore = budgetPosts(calls).length;

      const retry = await handler!(pushRequest(jwt, RETRY_YEAR));
      const body = await retry.json() as { years?: Array<Record<string, unknown>> };
      assertEquals(retry.status, 200, JSON.stringify(body));
      assertEquals(yearRow.push_state, 'pushed', `push_error: ${String(yearRow.push_error)}`);
      assertEquals(yearRow.erp_budget_name, yearBudget);
      assertEquals(budgetPosts(calls).slice(postsBefore).length, 0,
        'the held year is converged from its confirmed row, never re-posted');
    });
  });

  it('still converges a year whose confirmed row was written by an earlier Retry that named the year', async () => {
    const seed = freshSeed();
    const fixture = servedRoutes(seed, 15);
    const jwt = await auth.mintJwt({ sub: USER_ID });
    await withFetchMock(fixture.routes, async ({ calls }) => {
      const { outbox, savedPayload } = await activateThenRepair(jwt, calls, fixture, seed);
      // Before #1370 a Retry stored `target_fiscal_year` inside the command, so its row's digest covers it.
      outbox.payload_digest = await canonicalCommandDigest({
        domain: 'budget', operation: 'create', record: { ...savedPayload, target_fiscal_year: RETRY_YEAR },
      });

      const retry = await handler!(pushRequest(jwt, RETRY_YEAR));
      const body = await retry.json() as { years?: Array<Record<string, unknown>> };
      assertEquals(retry.status, 200, JSON.stringify(body));
      const yearRow = fixture.budgetMirrorRows.find((row) => row.fiscal_year === RETRY_YEAR);
      assertEquals(yearRow?.push_state, 'pushed', `push_error: ${String(yearRow?.push_error)}`);
    });
  });
});
