/**
 * AC-BFY-027 (FR-BFY-076, review finding 7) — PMO NEVER AMENDS A LIVE ERP `Budget` IT DOES NOT OWN.
 *
 * ⚑ THE FACT: `refs.self` (the upsert target) requires a PMO **ownership witness** — an `external_refs`
 * mapping for this domain and this YEAR-QUALIFIED identity — not bare occupancy of the
 * (company, fiscal_year, project) grain. Occupancy says only "a document is there"; it says nothing
 * about who wrote it. Without the witness, a submitted Budget an accountant authored in Desk was
 * CANCELLED and AMENDED with PMO's figures, and then recorded as PMO's push — the exact
 * never-fight-the-operator posture P3c is built on, inverted.
 *
 * Drives the SHIPPED served handler with `globalThis.fetch` mocked, so the assertion is about ERP
 * STATE (what documents exist and what was written to them), not about a request body.
 *
 * Verify: deno test --allow-all supabase/functions/adapter-dispatch/bfyUnownedLiveOccupant.test.ts
 */
import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';
import {
  createJwtAuthority,
  createTestJwksResolver,
  installEdgeEnv,
  withFetchMock,
  type FetchCall,
} from '../_shared/testing/edgeTestKit.ts';
import { encodeFiscalYear } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/fiscalYearEncoding.ts';
import {
  ERP_HOST,
  installErpCredentials,
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

/** A single-fiscal-year project, so exactly ONE year's grain is at stake. */
function singleYearSeed(over: Partial<ServedSeed> = {}): ServedSeed {
  return twoYearPhasedSeed({
    projectStartDate: '2026-02-01',
    projectEndDate: '2026-11-30',
    lineItems: [{ id: 'li-1', category: 'Labor', budgeted_amount: '90000.00', fiscal_year: null }],
    ...over,
  });
}

/** The accountant's own submitted Budget, authored directly in Desk. */
const DESK_BUDGET = { name: 'DESK-BUDGET-1', docstatus: 1, amended_from: null, owner: 'accountant@client.test' };

async function run(seed: ServedSeed) {
  const { routes, erpBudgets } = servedRoutes(seed);
  return await withFetchMock(routes, async ({ calls }) => {
    const jwt = await auth.mintJwt({ sub: USER_ID });
    const res = await servedHandler!(
      new Request('http://edge.test/adapter-dispatch', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ domain: 'budget', operation: 'create', record: { id: VERSION_ID, erp_doc_kind: 'budget' } }),
      }),
    );
    return { res, body: await res.json(), calls, erpBudgets };
  });
}

/** Every write ERPNext received for a named document (a cancel/amend is a PUT). */
function writesTo(calls: FetchCall[], name: string): FetchCall[] {
  return calls.filter(
    (c) => c.url.host === ERP_HOST && c.url.pathname === `/api/resource/Budget/${name}` && c.method !== 'GET',
  );
}

describe('AC-BFY-027 — a Desk-authored live Budget is not amended', () => {
  it('AC-BFY-027: an UNOWNED live occupant fails closed and ERP still holds exactly the one Desk Budget', async () => {
    const { res, body, calls, erpBudgets } = await run(
      singleYearSeed({ grainByFiscalYear: { '2026': [DESK_BUDGET] } }),
    );

    assertEquals(res.status, 422);
    assertEquals(body.error, 'budget-unowned-live-occupant');
    // The message must name the document AND the year — an operator cannot resolve what it cannot find.
    assert(String(body.message).includes('DESK-BUDGET-1'), body.message);
    assert(String(body.message).includes('2026'), body.message);

    // ⚑ THE ERP-STATE ASSERTION: PMO wrote NOTHING. No cancel, no amend, no new Budget.
    assertEquals(writesTo(calls, 'DESK-BUDGET-1').length, 0, 'the accountant’s document is untouched');
    assertEquals(erpBudgets.length, 0, 'PMO created no Budget of its own either');
  });

  it('AC-BFY-027: a PMO-CREATED live occupant IS still amended — the REVISE path must not break', async () => {
    // The ordinary revision: this is version 2's push, and the document on the grain is the one
    // version 1 created. The witness is therefore recorded against the PREVIOUS version's identity —
    // which is exactly why ownership is judged on the DOCUMENT, not on this version's own mapping.
    const previousVersionIdentity = `00000000-0000-4000-8000-0000000000v1:${encodeFiscalYear('2026')}`;
    const { res, calls } = await run(
      singleYearSeed({
        grainByFiscalYear: { '2026': [{ name: 'PMO-BUDGET-1', docstatus: 1, amended_from: null, owner: 'pmo@client.test' }] },
        externalRefs: { [previousVersionIdentity]: 'PMO-BUDGET-1' },
      }),
    );
    assertEquals(res.status, 200);
    // The upsert ran: PMO cancelled its own previous document and replaced it.
    assert(writesTo(calls, 'PMO-BUDGET-1').length > 0, 'PMO revises the document it owns');
  });

  it('AC-BFY-027: a mapping to a DIFFERENT document is not a witness for this one', async () => {
    // PMO has pushed this project before — for another year — so `external_refs` is not empty. That
    // says nothing about who wrote the document sitting on THIS year's grain.
    const { res, body, calls } = await run(
      singleYearSeed({
        grainByFiscalYear: { '2026': [DESK_BUDGET] },
        externalRefs: { [`${VERSION_ID}:${encodeFiscalYear('2027')}`]: 'ANOTHER-YEARS-BUDGET' },
      }),
    );
    assertEquals(res.status, 422);
    assertEquals(body.error, 'budget-unowned-live-occupant');
    assertEquals(writesTo(calls, 'DESK-BUDGET-1').length, 0);
  });

  it('AC-BFY-027: a DRAFT rival is still refused with its own state (unchanged, zero-write)', async () => {
    const { res, body, calls } = await run(
      singleYearSeed({ grainByFiscalYear: { '2026': [{ name: 'DRAFT-1', docstatus: 0, amended_from: null, owner: 'somebody@client.test' }] } }),
    );
    assertEquals(res.status, 422);
    assertEquals(body.error, 'budget-draft-rival-on-grain');
    assertEquals(writesTo(calls, 'DRAFT-1').length, 0);
  });
});
