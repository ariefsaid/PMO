/**
 * AC-BFY-030 (FR-BFY-031/038) — a delimiter-bearing `Fiscal Year` NAME round-trips through the
 * server-derived key, the year-qualified outbox identity and the identity parser, at the REAL served
 * boundary.
 *
 * ⚑ WHY THIS IS ITS OWN AC. ERPNext `Fiscal Year` names are CLIENT DATA. A raw `<vid>:<fiscal_year>`
 * identity is ambiguous the moment a name contains `:`, and a name bearing letters or spaces fails the
 * shipped key guard's charset outright — so the year is canonically ENCODED, and the encoding must be
 * lossless for any name the client can type. `'A:B 2026'` is the adversarial case: it carries the
 * identity delimiter AND a space.
 *
 * Verify: deno test --allow-all supabase/functions/adapter-dispatch/bfyColonFyRoundtrip.test.ts
 */
import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';
import {
  createJwtAuthority,
  createTestJwksResolver,
  installEdgeEnv,
  restCall,
  withFetchMock,
} from '../_shared/testing/edgeTestKit.ts';
import {
  budgetVersionIdOf,
  decodeFiscalYear,
  encodeFiscalYear,
} from '../../../pmo-portal/src/lib/adapterSeam/erpnext/fiscalYearEncoding.ts';
import { isOpaqueIdempotencyKey } from './transitionTargetGuard.ts';
import {
  ACTIVATED_AT_EPOCH_MS,
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

const COLON_FY = 'A:B 2026';

/** The same two-year project, but the client named its first fiscal year with a colon and a space. */
function colonFySeed() {
  return twoYearPhasedSeed({
    fiscalYears: [
      { name: COLON_FY, year_start_date: '2026-01-01', year_end_date: '2026-12-31' },
      { name: 'FY 2027', year_start_date: '2027-01-01', year_end_date: '2027-12-31' },
    ],
    lineItems: [
      { id: 'li-1', category: 'Labor', budgeted_amount: '90000.00', fiscal_year: COLON_FY },
      { id: 'li-2', category: 'Materials', budgeted_amount: '50000.00', fiscal_year: 'FY 2027' },
    ],
  });
}

describe('AC-BFY-030 — delimiter-bearing fiscal-year names round-trip end to end', () => {
  it('AC-BFY-030: a colon- and space-bearing Fiscal Year name pushes without a key-guard rejection', async () => {
    const { routes } = servedRoutes(colonFySeed());
    const { res, calls } = await withFetchMock(routes, async ({ calls }) => {
      const jwt = await auth.mintJwt({ sub: USER_ID });
      const res = await servedHandler!(
        new Request('http://edge.test/adapter-dispatch', {
          method: 'POST',
          headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
          body: JSON.stringify({ domain: 'budget', operation: 'create', record: { id: VERSION_ID, erp_doc_kind: 'budget' } }),
        }),
      );
      return { res, body: await res.json(), calls };
    });
    assertEquals(res.status, 200);

    const inserts = restCall(calls, 'external_command_outbox', 'POST').map((c) => c.bodyJson as Record<string, unknown>);
    assertEquals(inserts.length, 2);

    for (const [fy, insert] of [[COLON_FY, inserts[0]], ['FY 2027', inserts[1]]] as const) {
      const identity = String(insert.pmo_record_id);
      const key = String(insert.idempotency_key);
      // The identity is unambiguous: the bare version UUID is recoverable even though the ENCODED year
      // itself contains a `:` (the split is on the FIRST one, and a canonical UUID has none).
      assertEquals(budgetVersionIdOf(identity), VERSION_ID);
      assertEquals(decodeFiscalYear(identity.slice(identity.indexOf(':') + 1)), fy, 'the name decodes back EXACTLY');
      assertEquals(key, `bud:${VERSION_ID}:${encodeFiscalYear(fy)}:${ACTIVATED_AT_EPOCH_MS}`);
      // The served guard would have refused the whole push before the outbox had the shape been wrong.
      assert(isOpaqueIdempotencyKey(key), `the served key guard accepts the derived key for "${fy}"`);
    }
    // Two different names ⇒ two different identities (no collision through the encoding).
    assert(inserts[0].pmo_record_id !== inserts[1].pmo_record_id);
  });

  it('AC-BFY-030: the served guard refuses a per-year budget key whose encoded year is empty', () => {
    // The mutation this pins: an encoding that silently dropped the year would make every year of a
    // version share one identity, and only the first would ever reach ERP.
    assert(!isOpaqueIdempotencyKey(`bud:${VERSION_ID}::${ACTIVATED_AT_EPOCH_MS}`), 'an empty year token is refused');
    assert(
      !isOpaqueIdempotencyKey(`bud:${VERSION_ID}:${encodeFiscalYear(COLON_FY)}:not-an-epoch`),
      'a non-numeric activation stamp is refused',
    );
    assert(isOpaqueIdempotencyKey(`bud:${VERSION_ID}:${encodeFiscalYear(COLON_FY)}:${ACTIVATED_AT_EPOCH_MS}`));
    // A long client fiscal-year NAME is exactly the case the pre-BFY guard's {4,40} bound rejected —
    // the server would have derived a key its own boundary refused, and the push could never land.
    const longName = 'Financial Year 2026-2027 (Jul-Jun, consolidated)';
    assert(isOpaqueIdempotencyKey(`bud:${VERSION_ID}:${encodeFiscalYear(longName)}:${ACTIVATED_AT_EPOCH_MS}`));
    // The PRE-BFY single-year key still passes — those outbox rows exist and a retry must be accepted.
    assert(isOpaqueIdempotencyKey(`bud:${VERSION_ID}:${ACTIVATED_AT_EPOCH_MS}`));
  });
});
