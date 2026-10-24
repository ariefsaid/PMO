/**
 * 0379 follow-up — after the one-off repair confirms the account that already reached ERPNext, an operator's
 * Retry sends only the accounts that never did, and leaves the confirmed account `pushed`.
 *
 * The production shape these tests reproduce: the version's first push came from ACTIVATION (no fiscal year
 * named), so the confirmed outbox row's saved digest is the activation command's. The operator's Retry names
 * the fiscal year (`target_fiscal_year`). That request-scoping field must not make the retried account a
 * "different payload under the same key", or the confirmed account is recorded `failed` and the sweep then
 * parks it `held` with nothing left to re-send it. Drives the SHIPPED handler with `globalThis.fetch` mocked.
 */
import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';
import { createJwtAuthority, createTestJwksResolver, installEdgeEnv, withFetchMock, type FetchCall } from '../_shared/testing/edgeTestKit.ts';
import { installErpCredentials, servedRoutes, twoYearPhasedSeed, USER_ID, VERSION_ID } from './bfyServedFixture.ts';
import { budgetAccountIdentity } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/budgetAccountIdentity.ts';
import { canonicalCommandDigest } from './moneyOutboxDeps.ts';

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

/**
 * Activation pushes Labor (Materials is refused by a Desk draft rival before its outbox row), then the state
 * 0379 leaves behind: Labor's outbox row `confirmed` with its saved canonical, its ref recorded, its mirror
 * slot named. `digestOf` lets a test restate the saved digest as an older dispatch wrote it.
 */
async function activateThenRepair(
  jwt: string,
  calls: FetchCall[],
  fixture: ReturnType<typeof servedRoutes>,
  seed: ReturnType<typeof twoYearPhasedSeed>,
) {
  const activation = await handler!(pushRequest(jwt));
  await activation.body?.cancel();
  assertEquals(fixture.erpBudgets.map((doc) => doc.body.account), [LABOR]);
  const laborBudget = fixture.erpBudgets[0].name;
  const laborIdentity = budgetAccountIdentity(VERSION_ID, '2026', LABOR);
  const outbox = [...fixture.outboxRows.values()].find((row) => row.pmo_record_id === laborIdentity)!;
  Object.assign(outbox, {
    state: 'confirmed',
    external_record_id: laborBudget,
    canonical: { id: VERSION_ID, fiscal_year: '2026', erp_account: LABOR, erp_budget_name: laborBudget, erp_docstatus: 1 },
  });
  seed.externalRefs = { [laborIdentity]: laborBudget };
  seed.grainByAccountYear = { [`2026|${LABOR}`]: [{ name: laborBudget, docstatus: 1, amended_from: null, owner: 'pmo' }] };
  const insert = calls.find((call) => call.method === 'POST' && call.url.pathname === '/rest/v1/external_command_outbox' &&
    (call.bodyJson as { pmo_record_id?: unknown }).pmo_record_id === laborIdentity)!;
  const savedPayload = (insert.bodyJson as { payload: Record<string, unknown> }).payload;
  return { laborBudget, outbox, savedPayload };
}

function freshSeed() {
  return twoYearPhasedSeed({
    fiscalYears: [{ name: '2026', year_start_date: '2026-01-01', year_end_date: '2026-12-31' }],
    lineItems: [
      { id: 'li-labor', category: 'Labor', budgeted_amount: '50000.00', fiscal_year: '2026' },
      { id: 'li-materials', category: 'Materials', budgeted_amount: '25000.00', fiscal_year: '2026' },
    ],
    projectStartDate: '2026-01-01', projectEndDate: '2026-12-31',
    grainByAccountYear: { [`2026|${MATERIALS}`]: [{ name: 'BUDGET-DESK-DRAFT', docstatus: 0, amended_from: null, owner: 'desk' }] },
  });
}

describe('AC-BV16-010 Retry after the 0379 repair', () => {
  it('leaves the already-pushed account pushed and sends only the missing accounts', async () => {
    const seed = freshSeed();
    const fixture = servedRoutes(seed, 16);
    const jwt = await auth.mintJwt({ sub: USER_ID });
    await withFetchMock(fixture.routes, async ({ calls }) => {
      const { laborBudget } = await activateThenRepair(jwt, calls, fixture, seed);
      const postsBefore = budgetPosts(calls).length;

      const retry = await handler!(pushRequest(jwt, '2026'));
      assertEquals(retry.status, 200, await retry.text());
      assertEquals(budgetPosts(calls).slice(postsBefore).map((call) => (call.bodyJson as Record<string, unknown>).account), [MATERIALS],
        'Retry posts the missing account once and never the confirmed one');
      const labor = fixture.accountMirrorRows.find((row) => row.erp_account === LABOR);
      assertEquals(labor?.push_state, 'pushed', `the confirmed account stays pushed (push_error: ${String(labor?.push_error)})`);
      assertEquals(labor?.erp_budget_name, laborBudget);
      assertEquals(fixture.accountMirrorRows.find((row) => row.erp_account === MATERIALS)?.push_state, 'pushed');
      assertEquals(fixture.erpBudgets.filter((doc) => doc.body.account === LABOR).length, 1, 'ERPNext still holds exactly one Labor Budget');
    });
  });

  it('turns an account the sweep parked held back to pushed on one Retry, with no ERPNext write', async () => {
    const seed = freshSeed();
    const fixture = servedRoutes(seed, 16);
    const jwt = await auth.mintJwt({ sub: USER_ID });
    await withFetchMock(fixture.routes, async ({ calls }) => {
      const { laborBudget } = await activateThenRepair(jwt, calls, fixture, seed);
      const labor = fixture.accountMirrorRows.find((row) => row.erp_account === LABOR)!;
      Object.assign(labor, { push_state: 'held', push_error: 'budget-push-attempts-exhausted' });
      const postsBefore = budgetPosts(calls).filter((call) => (call.bodyJson as Record<string, unknown>).account === LABOR).length;

      const retry = await handler!(pushRequest(jwt, '2026'));
      await retry.body?.cancel();
      assertEquals(labor.push_state, 'pushed', `push_error: ${String(labor.push_error)}`);
      assertEquals(labor.erp_budget_name, laborBudget);
      assertEquals(budgetPosts(calls).filter((call) => (call.bodyJson as Record<string, unknown>).account === LABOR).length, postsBefore,
        'the held account is converged from its confirmed row, never re-posted');
    });
  });

  it('still converges an account whose confirmed row was written by an earlier Retry that named the year', async () => {
    const seed = freshSeed();
    const fixture = servedRoutes(seed, 16);
    const jwt = await auth.mintJwt({ sub: USER_ID });
    await withFetchMock(fixture.routes, async ({ calls }) => {
      const { outbox, savedPayload } = await activateThenRepair(jwt, calls, fixture, seed);
      // Before this fix a Retry stored `target_fiscal_year` inside the command, so its row's digest covers it.
      outbox.payload_digest = await canonicalCommandDigest({
        domain: 'budget', operation: 'create', record: { ...savedPayload, target_fiscal_year: '2026' },
      });

      const retry = await handler!(pushRequest(jwt, '2026'));
      assertEquals(retry.status, 200, await retry.text());
      const labor = fixture.accountMirrorRows.find((row) => row.erp_account === LABOR);
      assertEquals(labor?.push_state, 'pushed', `push_error: ${String(labor?.push_error)}`);
    });
  });
});
