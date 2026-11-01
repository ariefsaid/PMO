/**
 * AC-ECA-031 (FR-ECA-041, PD-ECA-12) — an ERP Budget PMO does not own has two ways forward, and neither is silent.
 *
 *   • USE AS DRAFT: the ERP figures become a PMO Draft version; the ERP is read, never written.
 *   • REPLACE: the ordinary push may amend that exact ERP document only while a server-recorded consent row
 *     (same org, project, account, year and ERP document name, unconsumed) exists. The payload never asserts it.
 *
 * Drives the SHIPPED served handler with `globalThis.fetch` mocked, so every assertion is about ERP STATE
 * (what was written to which document) and about which database calls the handler made.
 *
 * Verify: deno test --allow-all supabase/functions/adapter-dispatch/budgetOccupant.served.test.ts
 */
import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';
import {
  createJwtAuthority,
  createTestJwksResolver,
  installEdgeEnv,
  jsonResponse,
  supabaseRpc,
  supabaseSelect,
  withFetchMock,
  type FetchCall,
  type MockRoute,
} from '../_shared/testing/edgeTestKit.ts';
import { budgetAccountIdentity } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/budgetAccountIdentity.ts';
import {
  ERP_HOST,
  installErpCredentials,
  ORG_ID,
  PROJECT_ID,
  servedRoutes,
  twoYearPhasedSeed,
  USER_ID,
  VERSION_ID,
  type ServedSeed,
} from './bfyServedFixture.ts';

const env = installEdgeEnv();
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
const restoreCreds = installErpCredentials();
const auth = await createJwtAuthority(env.SUPABASE_URL);

let servedHandler: ((req: Request) => Promise<Response>) | null = null;
(Deno as unknown as { serve: (h: unknown) => unknown }).serve = (h: unknown) => {
  servedHandler = h as (req: Request) => Promise<Response>;
  return { finished: Promise.resolve() };
};
const { setTestJwks } = await import('./index.ts');
setTestJwks(createTestJwksResolver(auth));

addEventListener('unload', () => {
  restoreCreds();
  env.restore();
});

const OTHER_ORG_ID = '99999999-9999-4999-8999-999999999999';
const ACCOUNT = '5100 - Labor - AL';
const DESK = 'DESK-BUDGET';
const DRAFT_ID = '55555555-5555-4555-8555-555555555555';

/** The accountant's own submitted v16 Budget: one account, FY 2026, 50,000,000. */
const DESK_DOC = {
  name: DESK, docstatus: 1, amended_from: null, owner: 'accountant@client.test',
  company: 'ACME Ltd', project: 'ERP-PROJ-1', account: ACCOUNT, from_fiscal_year: '2026', to_fiscal_year: '2026', budget_amount: 50000000,
};

function seed16(over: Partial<ServedSeed> = {}): ServedSeed {
  return twoYearPhasedSeed({
    fiscalYears: [{ name: '2026', year_start_date: '2026-01-01', year_end_date: '2026-12-31' }],
    lineItems: [{ id: 'li-1', category: 'Labor', budgeted_amount: '90000.00', fiscal_year: '2026' }],
    projectStartDate: '2026-02-01',
    projectEndDate: '2026-11-30',
    grainByAccountYear: { [`2026|${ACCOUNT}`]: [DESK_DOC] },
    ...over,
  });
}

interface Consent {
  id: string; org_id: string; project_id: string; fiscal_year: string; erp_account: string;
  erp_budget_name: string; consented_at: string; consumed_at: string | null;
}
function consent(over: Partial<Consent> = {}): Consent {
  return {
    id: 'c0000000-0000-4000-8000-000000000001', org_id: ORG_ID, project_id: PROJECT_ID, fiscal_year: '2026',
    erp_account: ACCOUNT, erp_budget_name: DESK, consented_at: new Date().toISOString(), consumed_at: null, ...over,
  };
}

const objectHeaders = { 'content-type': 'application/vnd.pgrst.object+json' };

/** Routes only this slice adds; they sit in front of the shared fixture (first match wins). */
function slice(opts: { role?: string; consents?: Consent[]; erpDoc?: Record<string, unknown>; categoryMap?: Array<{ category: string; erp_account: string }> }) {
  const consents = opts.consents ?? [];
  const consumed: string[] = [];
  const drafts: Array<{ args: Record<string, unknown>; authorization: string | null }> = [];
  const routes: MockRoute[] = [
    supabaseRpc('actor_authorization_state', () => jsonResponse({ role: opts.role ?? 'Finance', active: true })),
    // Honours every filter the code sends, so a missing `.eq('org_id', …)` returns another org's row.
    supabaseSelect('budget_occupant_consents', (call) => {
      const p = call.url.searchParams;
      const eq = (k: string) => { const v = p.get(k); return v?.startsWith('eq.') ? decodeURIComponent(v.slice(3)) : null; };
      const after = p.get('consented_at')?.replace(/^gte\./, '');
      const row = consents.find((c) =>
        (eq('org_id') === null || c.org_id === eq('org_id')) && (eq('project_id') === null || c.project_id === eq('project_id')) &&
        (eq('fiscal_year') === null || c.fiscal_year === eq('fiscal_year')) && (eq('erp_account') === null || c.erp_account === eq('erp_account')) &&
        (eq('erp_budget_name') === null || c.erp_budget_name === eq('erp_budget_name')) &&
        (p.get('consumed_at') !== 'is.null' || c.consumed_at === null) && (!after || c.consented_at >= after));
      return row ? jsonResponse(row, { headers: objectHeaders }) : new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
    }),
    supabaseRpc('consume_budget_occupant_consent', (call) => {
      const id = String((call.bodyJson as { p_id?: unknown }).p_id);
      consumed.push(id);
      const row = consents.find((c) => c.id === id);
      if (row) row.consumed_at = new Date().toISOString();
      return jsonResponse(null);
    }),
    supabaseRpc('create_budget_draft_from_erp', (call) => {
      drafts.push({ args: call.bodyJson as Record<string, unknown>, authorization: call.headers.get('authorization') });
      return jsonResponse(DRAFT_ID);
    }),
    { label: 'ERP Desk budget read', method: 'GET', host: ERP_HOST, pathname: `/api/resource/Budget/${DESK}`, response: () => jsonResponse({ data: opts.erpDoc ?? DESK_DOC }) },
    ...(opts.categoryMap ? [supabaseSelect('budget_category_account_map', () => jsonResponse(opts.categoryMap))] : []),
  ];
  return { routes, consents, consumed, drafts };
}

async function post(body: unknown, routes: MockRoute[]) {
  return await withFetchMock(routes, async ({ calls }) => {
    const jwt = await auth.mintJwt({ sub: USER_ID });
    const res = await servedHandler!(
      new Request('http://edge.test/adapter-dispatch', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    return { res, body: await res.json(), calls, jwt };
  });
}

const push = () => ({ domain: 'budget', operation: 'create', record: { id: VERSION_ID, erp_doc_kind: 'budget' } });
const occupant = (action: string, over: Record<string, unknown> = {}) => ({
  domain: 'budget', operation: 'read',
  record: { id: PROJECT_ID, erp_doc_kind: 'budget-occupant', action, projectId: PROJECT_ID, fiscalYear: '2026', erpAccount: ACCOUNT, ...over },
});
const erpWrites = (calls: FetchCall[]) => calls.filter((c) => c.url.host === ERP_HOST && c.method !== 'GET');
const writesTo = (calls: FetchCall[], name: string) => erpWrites(calls).filter((c) => c.url.pathname === `/api/resource/Budget/${name}`);

describe('AC-ECA-031 — use the ERP figures as a PMO draft', () => {
  it('AC-ECA-031 use as draft: a PMO Draft version holds the ERP figures and the ERP is unchanged', async () => {
    const s = slice({});
    const { routes } = servedRoutes(seed16(), 16);
    const { res, body, calls, jwt } = await post(occupant('use-as-draft'), [...s.routes, ...routes]);

    assertEquals(res.status, 200, JSON.stringify(body));
    assertEquals(body.draftVersionId, DRAFT_ID);
    assertEquals(s.drafts.length, 1);
    assertEquals(s.drafts[0].args, {
      p_project_id: PROJECT_ID,
      p_erp_budget_name: DESK,
      p_lines: [{ category: 'Labor', budgeted_amount: '50000000.00', fiscal_year: '2026' }],
    });
    // Runs as the caller (RLS and the authorship triggers apply), never as the service role.
    assertEquals(s.drafts[0].authorization, `Bearer ${jwt}`);
    assertEquals(erpWrites(calls).length, 0, 'the ERP saw no POST/PUT');
  });

  it('AC-ECA-031 use as draft: an ERP account with no category mapping is refused naming the account, no draft', async () => {
    const s = slice({ categoryMap: [{ category: 'Materials', erp_account: '5200 - Materials - AL' }] });
    const { routes } = servedRoutes(seed16(), 16);
    const { res, body } = await post(occupant('use-as-draft'), [...s.routes, ...routes]);

    assertEquals(res.status, 422);
    assert(String(body.message).includes(ACCOUNT), body.message);
    assertEquals(s.drafts.length, 0);
  });

  it('AC-ECA-031 use as draft: no live ERP budget on that account and year is refused, no draft', async () => {
    const s = slice({});
    const { routes } = servedRoutes(seed16({ grainByAccountYear: {} }), 16);
    const { res } = await post(occupant('use-as-draft'), [...s.routes, ...routes]);

    assertEquals(res.status, 422);
    assertEquals(s.drafts.length, 0);
  });

  it('AC-ECA-031 use as draft: the draft carries the ERP amount to the cent, with no float rounding', async () => {
    const s = slice({ erpDoc: { ...DESK_DOC, budget_amount: 1234567.89 } });
    const { routes } = servedRoutes(seed16(), 16);
    const { res, body } = await post(occupant('use-as-draft'), [...s.routes, ...routes]);

    assertEquals(res.status, 200, JSON.stringify(body));
    assertEquals((s.drafts[0].args.p_lines as Array<{ budgeted_amount: string }>)[0].budgeted_amount, '1234567.89');
  });

  it('AC-ECA-031 use as draft: an amount too large to hold exactly in cents is refused, no draft', async () => {
    const s = slice({ erpDoc: { ...DESK_DOC, budget_amount: '90071992547409.93' } });
    const { routes } = servedRoutes(seed16(), 16);
    const { res } = await post(occupant('use-as-draft'), [...s.routes, ...routes]);

    assertEquals(res.status, 422);
    assertEquals(s.drafts.length, 0);
  });

  it('AC-ECA-031 inspect names the exact ERP budget a replace would touch, and writes nothing', async () => {
    const s = slice({});
    const { routes } = servedRoutes(seed16(), 16);
    const { res, body, calls } = await post(occupant('inspect'), [...s.routes, ...routes]);

    assertEquals(res.status, 200);
    assertEquals(body, { erpBudgetName: DESK, erpAccount: ACCOUNT, fiscalYear: '2026' });
    assertEquals(erpWrites(calls).length, 0);
  });

  for (const action of ['use-as-draft', 'inspect']) {
    it(`AC-ECA-031 ${action}: an Engineer is refused (403) before any ERP call`, async () => {
      const s = slice({ role: 'Engineer' });
      const { routes } = servedRoutes(seed16(), 16);
      const { res, calls } = await post(occupant(action), [...s.routes, ...routes]);

      assertEquals(res.status, 403);
      assertEquals(s.drafts.length, 0);
      assertEquals(calls.filter((c) => c.url.host === ERP_HOST).length, 0);
    });
  }
});

describe('AC-ECA-031 — replace the ERP budget only on a consent naming it', () => {
  const identity = budgetAccountIdentity(VERSION_ID, '2026', ACCOUNT);
  assert(identity.length > 0);

  it('AC-ECA-031 replace: refused without a consent row naming the ERP budget', async () => {
    const s = slice({});
    const { routes, erpBudgets } = servedRoutes(seed16(), 16);
    const { res, body, calls } = await post(push(), [...s.routes, ...routes]);

    assertEquals(res.status, 422);
    assertEquals(body.error, 'budget-unowned-live-occupant');
    assertEquals(writesTo(calls, DESK).length, 0);
    assertEquals(erpBudgets.length, 0);
    assertEquals(s.consumed.length, 0);
  });

  it('AC-ECA-031 replace: with a consent row naming DESK-BUDGET the push amends it through the push path and consumes the consent', async () => {
    const s = slice({ consents: [consent()] });
    const { routes, erpBudgets } = servedRoutes(seed16(), 16);
    const { res, body, calls } = await post(push(), [...s.routes, ...routes]);

    assertEquals(res.status, 200, JSON.stringify(body));
    assert(writesTo(calls, DESK).length > 0, 'the confirmed ERP budget was cancelled');
    assertEquals(erpBudgets.length, 1);
    assertEquals(erpBudgets[0].body.amended_from, DESK, 'the new document amends the confirmed one');
    assert(calls.some((c) => c.url.pathname === '/rest/v1/rpc/record_outbox_ref'), 'PMO now owns the new document');
    assertEquals(s.consumed, [consent().id]);
    assert(s.consents[0].consumed_at !== null);
  });

  it('AC-ECA-031 replace: a consumed consent is single-use, the next push is refused again', async () => {
    const s = slice({ consents: [consent({ consumed_at: new Date().toISOString() })] });
    const { routes, erpBudgets } = servedRoutes(seed16(), 16);
    const { res, body, calls } = await post(push(), [...s.routes, ...routes]);

    assertEquals(res.status, 422);
    assertEquals(body.error, 'budget-unowned-live-occupant');
    assertEquals(writesTo(calls, DESK).length, 0);
    assertEquals(erpBudgets.length, 0);
  });

  it('AC-ECA-031 replace: a consent naming OTHER-BUDGET does not unlock DESK-BUDGET', async () => {
    const s = slice({ consents: [consent({ erp_budget_name: 'OTHER-BUDGET' })] });
    const { routes, erpBudgets } = servedRoutes(seed16(), 16);
    const { res, body, calls } = await post(push(), [...s.routes, ...routes]);

    assertEquals(res.status, 422);
    assertEquals(body.error, 'budget-unowned-live-occupant');
    assertEquals(writesTo(calls, DESK).length, 0);
    assertEquals(erpBudgets.length, 0);
  });

  it('AC-ECA-031 replace: a consent from another org does not unlock this org’s ERP budget', async () => {
    const s = slice({ consents: [consent({ org_id: OTHER_ORG_ID })] });
    const { routes, erpBudgets } = servedRoutes(seed16(), 16);
    const { res, body, calls } = await post(push(), [...s.routes, ...routes]);

    assertEquals(res.status, 422);
    assertEquals(body.error, 'budget-unowned-live-occupant');
    assertEquals(writesTo(calls, DESK).length, 0);
    assertEquals(erpBudgets.length, 0);
  });

  it('AC-ECA-031 replace: a consent for another PMO project does not unlock it', async () => {
    const s = slice({ consents: [consent({ project_id: '66666666-6666-4666-8666-666666666666' })] });
    const { routes, erpBudgets } = servedRoutes(seed16(), 16);
    const { res, body, calls } = await post(push(), [...s.routes, ...routes]);

    assertEquals(res.status, 422);
    assertEquals(body.error, 'budget-unowned-live-occupant');
    assertEquals(writesTo(calls, DESK).length, 0);
    assertEquals(erpBudgets.length, 0);
    assertEquals(s.consumed.length, 0);
  });

  it('AC-ECA-031 replace: when the ERP budget already holds PMO’s figures the consent adopts it with no ERP write and is spent', async () => {
    const s = slice({ consents: [consent()], erpDoc: { ...DESK_DOC, budget_amount: 90000 } });
    const { routes, erpBudgets } = servedRoutes(seed16({ grainByAccountYear: { [`2026|${ACCOUNT}`]: [{ ...DESK_DOC, budget_amount: 90000 }] } }), 16);
    const { res, body, calls } = await post(push(), [...s.routes, ...routes]);

    assertEquals(res.status, 200, JSON.stringify(body));
    assertEquals(erpWrites(calls).length, 0, 'nothing to change in the ERP');
    assertEquals(erpBudgets.length, 0);
    assert(calls.some((c) => c.url.pathname === '/rest/v1/rpc/record_outbox_ref'), 'PMO now owns the adopted document');
    assertEquals(s.consumed, [consent().id]);
  });

  it('AC-ECA-031 replace: a consent for another account or year does not unlock it', async () => {
    for (const other of [{ erp_account: '5200 - Materials - AL' }, { fiscal_year: '2027' }]) {
      const s = slice({ consents: [consent(other)] });
      const { routes, erpBudgets } = servedRoutes(seed16(), 16);
      const { res, body, calls } = await post(push(), [...s.routes, ...routes]);

      assertEquals(res.status, 422);
      assertEquals(body.error, 'budget-unowned-live-occupant');
      assertEquals(writesTo(calls, DESK).length, 0);
      assertEquals(erpBudgets.length, 0);
    }
  });

  it('AC-ECA-031 replace: a stale consent (older than a day) does not unlock it', async () => {
    const s = slice({ consents: [consent({ consented_at: new Date(Date.now() - 25 * 3600_000).toISOString() })] });
    const { routes, erpBudgets } = servedRoutes(seed16(), 16);
    const { res, body, calls } = await post(push(), [...s.routes, ...routes]);

    assertEquals(res.status, 422);
    assertEquals(body.error, 'budget-unowned-live-occupant');
    assertEquals(writesTo(calls, DESK).length, 0);
    assertEquals(erpBudgets.length, 0);
  });

  it('AC-ECA-031 replace: a consent that cannot be read fails closed', async () => {
    const s = slice({ consents: [consent()] });
    const failing = supabaseSelect('budget_occupant_consents', () => jsonResponse({ message: 'boom', code: 'XX000' }, { status: 500 }));
    const { routes, erpBudgets } = servedRoutes(seed16(), 16);
    const { res, calls } = await post(push(), [failing, ...s.routes, ...routes]);

    assert(res.status >= 400);
    assertEquals(writesTo(calls, DESK).length, 0);
    assertEquals(erpBudgets.length, 0);
  });

  it('AC-ECA-031 replace: the payload cannot assert a consent', async () => {
    const s = slice({});
    const { routes, erpBudgets } = servedRoutes(seed16(), 16);
    const forged = { ...push(), record: { ...push().record, occupantConsentId: consent().id, erp_budget_name: DESK, occupant_consent: true } };
    const { res, body, calls } = await post(forged, [...s.routes, ...routes]);

    assertEquals(res.status, 422);
    assertEquals(body.error, 'budget-unowned-live-occupant');
    assertEquals(writesTo(calls, DESK).length, 0);
    assertEquals(erpBudgets.length, 0);
  });
});
