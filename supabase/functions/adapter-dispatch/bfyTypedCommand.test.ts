/**
 * AC-BFY-009 (FR-BFY-030/031/032/036) — the typed budget command threads the year-qualified identity
 * and the per-year key end to end, and the REAL served boundary accepts it.
 *
 * ⚑ THE FACT EACH ASSERTION NAMES. The outbox/`external_refs` identity is `<vid>:<encoded-fy>` while
 * `command.record.id` and the mirror FK stay the BARE `budget_version_id` UUID — that separation is
 * the whole point of the typed command (spec §5.1): a year in `record.id` makes the gate's
 * `budget_versions.id =` query return nothing ("version not readable"), and a year in the mirror FK is
 * a non-UUID against a `uuid` column. The mirror rows this push writes are **F-A** (a push that
 * SUCCEEDED); the failure writers exercised elsewhere write **F-B** (an attempt), which no attribution
 * predicate may consult.
 *
 * Drives the SHIPPED handler: `Deno.serve` is stubbed to capture the exact function `index.ts` hands
 * it, and `globalThis.fetch` is mocked (the Supabase-documented edge-fn testing shape). No handler
 * logic is re-implemented here.
 *
 * Verify: deno test --allow-all supabase/functions/adapter-dispatch/bfyTypedCommand.test.ts
 */
import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';
import {
  createJwtAuthority,
  createTestJwksResolver,
  installEdgeEnv,
  jsonResponse,
  restCall,
  supabaseSelect,
  withFetchMock,
  type FetchCall,
} from '../_shared/testing/edgeTestKit.ts';
import { encodeFiscalYear } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/fiscalYearEncoding.ts';
import {
  ACTIVATED_AT_EPOCH_MS,
  ERP_HOST,
  ERP_SITE_URL,
  installErpCredentials,
  ORG_ID,
  PROJECT_ID,
  SECRET_REF,
  servedRoutes,
  twoYearPhasedSeed,
  USER_ID,
  VERSION_ID,
  type ServedSeed,
} from './bfyServedFixture.ts';
import type { AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import type { BudgetDispatchUnit } from './budgetDispatch.ts';
import { commandForBudgetUnit } from './commandUnit.ts';

const env = installEdgeEnv();
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
const restoreCreds = installErpCredentials();
const auth = await createJwtAuthority(env.SUPABASE_URL);

// The shipped handler, captured from the module's own `Deno.serve` call — never re-declared here.
let servedHandler: ((req: Request) => Promise<Response>) | null = null;
(Deno as unknown as { serve: (h: unknown) => unknown }).serve = (h: unknown) => {
  servedHandler = h as (req: Request) => Promise<Response>;
  return { finished: Promise.resolve() };
};
const { setTestJwks } = await import('./index.ts');
// Local JWKS resolver — `createRemoteJWKSet` would start a background refresh interval the op
// sanitizer (rightly) reports as a leak.
setTestJwks(createTestJwksResolver(auth));

addEventListener('unload', () => {
  restoreCreds();
  env.restore();
});

async function dispatchBudget(): Promise<Response> {
  const jwt = await auth.mintJwt({ sub: USER_ID });
  const req = new Request('http://edge.test/adapter-dispatch', {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    // ⚑ THE CONTRACT CHANGE (FR-BFY-031, OQ-BFY-3): the client sends NO idempotency key. Only the
    // server can know the years (the calendar is a live ERP read the gate owns), so only the server
    // can derive the per-year key.
    body: JSON.stringify({
      domain: 'budget',
      operation: 'create',
      record: { id: VERSION_ID, erp_doc_kind: 'budget' },
    }),
  });
  const res = await servedHandler!(req);
  return res;
}

function outboxInserts(calls: FetchCall[]): Array<Record<string, unknown>> {
  return restCall(calls, 'external_command_outbox', 'POST').map((c) => c.bodyJson as Record<string, unknown>);
}

function mirrorUpserts(calls: FetchCall[]): Array<Record<string, unknown>> {
  return restCall(calls, 'budget_version_erp_mirror', 'POST').flatMap((c) => {
    const body = c.bodyJson;
    return (Array.isArray(body) ? body : [body]) as Array<Record<string, unknown>>;
  });
}

async function runServed(seed: ServedSeed) {
  const { routes, erpBudgets } = servedRoutes(seed);
  return await withFetchMock(routes, async ({ calls }) => {
    const res = await dispatchBudget();
    return { res, body: await res.json(), calls, erpBudgets };
  });
}

/** A PER-YEAR retry (FR-BFY-056): the client names the ONE fiscal year the operator is retrying. */
async function dispatchBudgetTargeted(fiscalYear: string): Promise<Response> {
  const jwt = await auth.mintJwt({ sub: USER_ID });
  const req = new Request('http://edge.test/adapter-dispatch', {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      domain: 'budget',
      operation: 'create',
      record: { id: VERSION_ID, erp_doc_kind: 'budget', target_fiscal_year: fiscalYear },
    }),
  });
  return await servedHandler!(req);
}

async function runServedTargeted(seed: ServedSeed, fiscalYear: string) {
  const { routes, erpBudgets } = servedRoutes(seed);
  return await withFetchMock(routes, async ({ calls }) => {
    const res = await dispatchBudgetTargeted(fiscalYear);
    return { res, body: await res.json(), calls, erpBudgets };
  });
}

describe('AC-1714 — commandForBudgetUnit mints a fresh per-unit command, never a rebinding', () => {
  const baseCommand: AdapterCommand = {
    domain: 'budget',
    operation: 'create',
    record: { id: VERSION_ID, erp_doc_kind: 'budget' },
    idempotencyKey: 'base-request-key',
  };

  it('AC-1714: each unit gets its own command object; the base command and its record are never mutated', () => {
    const recordA: AdapterCommand['record'] = { id: VERSION_ID, erp_doc_kind: 'budget', fiscal_year: '2026' };
    const recordB: AdapterCommand['record'] = { id: VERSION_ID, erp_doc_kind: 'budget', fiscal_year: '2027' };
    const unitA: BudgetDispatchUnit = {
      fiscalYear: '2026',
      erpAccount: null,
      identity: `${VERSION_ID}:${encodeFiscalYear('2026')}`,
      idempotencyKey: 'bud:key-for-2026',
      record: recordA,
    };
    const unitB: BudgetDispatchUnit = {
      fiscalYear: '2027',
      erpAccount: null,
      identity: `${VERSION_ID}:${encodeFiscalYear('2027')}`,
      idempotencyKey: 'bud:key-for-2027',
      record: recordB,
    };

    const a = commandForBudgetUnit(baseCommand, unitA);
    const b = commandForBudgetUnit(baseCommand, unitB);

    assert(a !== b, 'two budget units must not share one command object');
    assert(a !== baseCommand, 'unit A must not BE the request command');
    assert(b !== baseCommand, 'unit B must not BE the request command');
    assert(a.record === unitA.record, 'unit A command carries unit A record by reference');
    assert(b.record === unitB.record, 'unit B command carries unit B record by reference');
    assertEquals(a.domain, 'budget');
    assertEquals(a.operation, 'create');
    assertEquals(b.domain, 'budget');
    assertEquals(b.operation, 'create');
    assertEquals(a.idempotencyKey, 'bud:key-for-2026', 'unit A carries its own server-derived key');
    assertEquals(b.idempotencyKey, 'bud:key-for-2027', 'unit B carries its own server-derived key');
    // The unit identity stays the SEPARATE outbox argument — the helper never inserts it into the
    // command or its record (`record.id` must remain the bare version UUID).
    assertEquals('identity' in a, false);
    assertEquals('identity' in (a.record as Record<string, unknown>), false);

    // The base command is unchanged after constructing both per-unit commands.
    assertEquals(baseCommand.record, { id: VERSION_ID, erp_doc_kind: 'budget' });
    assertEquals(baseCommand.idempotencyKey, 'base-request-key');
  });

  it('AC-1714: two calls from the SAME base do not bleed a record property or key between units', () => {
    const a = commandForBudgetUnit(baseCommand, {
      fiscalYear: '2026',
      erpAccount: null,
      identity: 'identity-a',
      idempotencyKey: 'key-a',
      record: { id: VERSION_ID, erp_doc_kind: 'budget', fiscal_year: '2026', a_only: 'present-on-A' },
    });
    const b = commandForBudgetUnit(baseCommand, {
      fiscalYear: '2027',
      erpAccount: null,
      identity: 'identity-b',
      idempotencyKey: 'key-b',
      record: { id: VERSION_ID, erp_doc_kind: 'budget', fiscal_year: '2027' },
    });
    assertEquals('a_only' in (b.record as Record<string, unknown>), false, 'a record property present only on A must not appear on B');
    assertEquals((a.record as Record<string, unknown>).a_only, 'present-on-A');
    assertEquals(a.idempotencyKey, 'key-a');
    assertEquals(b.idempotencyKey, 'key-b');
  });
});

describe('HIGH 5 (FR-BFY-056) — a per-year retry dispatches ONLY that plan year', () => {
  it('HIGH 5: a FY2027 retry attempts ONLY FY2027 — FY2026 is never invoked', async () => {
    const { res, body, calls, erpBudgets } = await runServedTargeted(twoYearPhasedSeed(), '2027');
    assertEquals(res.status, 200, JSON.stringify(body));

    // The oracle records EVERY attempted identity (each outbox insert's pmo_record_id).
    const inserts = outboxInserts(calls);
    assertEquals(inserts.length, 1, 'a per-year retry writes exactly ONE outbox row (not the whole fan-out)');
    assertEquals(inserts[0].pmo_record_id, `${VERSION_ID}:${encodeFiscalYear('2027')}`);
    assert(
      !inserts.some((i) => i.pmo_record_id === `${VERSION_ID}:${encodeFiscalYear('2026')}`),
      'a FY2027 retry must NEVER invoke FY2026 (FR-BFY-056: the display-only argument re-drove every year)',
    );
    assertEquals(erpBudgets.length, 1);
    assertEquals(erpBudgets[0].body.fiscal_year, '2027');
  });

  it('HIGH 5: a retry for a year that is not a phased plan year is refused — never a silent whole fan-out', async () => {
    const { res, body, calls, erpBudgets } = await runServedTargeted(twoYearPhasedSeed(), '2099');
    assertEquals(res.status, 422, JSON.stringify(body));
    assertEquals(outboxInserts(calls).length, 0, 'an out-of-plan retry year touches the outbox not at all');
    assertEquals(erpBudgets.length, 0, 'and never reaches ERP');
  });

  it('HIGH 5: activation (no target year) still fans out to EVERY plan year — the whole-version op is unchanged', async () => {
    const { res, calls } = await runServed(twoYearPhasedSeed());
    assertEquals(res.status, 200);
    const identities = outboxInserts(calls).map((i) => i.pmo_record_id);
    assertEquals(identities, [`${VERSION_ID}:${encodeFiscalYear('2026')}`, `${VERSION_ID}:${encodeFiscalYear('2027')}`]);
  });
});

describe('AC-BFY-009 — served budget fan-out: year-qualified identity + per-year key', () => {
  it('AC-BFY-009: a two-year phased plan fans out to one ERP Budget, outbox row and mirror row PER YEAR', async () => {
    const { res, body, calls, erpBudgets } = await runServed(twoYearPhasedSeed());
    assertEquals(res.status, 200, JSON.stringify(body));

    const inserts = outboxInserts(calls);
    assertEquals(inserts.length, 2, 'one outbox row per phased fiscal year');
    for (const [fy, insert] of [['2026', inserts[0]], ['2027', inserts[1]]] as const) {
      const identity = `${VERSION_ID}:${encodeFiscalYear(fy)}`;
      assertEquals(insert.pmo_record_id, identity, `outbox identity is year-qualified for FY${fy}`);
      assertEquals(
        insert.idempotency_key,
        `bud:${VERSION_ID}:${encodeFiscalYear(fy)}:${ACTIVATED_AT_EPOCH_MS}`,
        `the per-year key is server-derived for FY${fy}`,
      );
    }

    // ERP holds exactly one Budget per phased year, each carrying only that year's accounts.
    assertEquals(erpBudgets.length, 2);
    assertEquals(erpBudgets.map((b) => b.body.fiscal_year), ['2026', '2027']);
    assertEquals((erpBudgets[0].body.accounts as unknown[]).length, 1);
    assertEquals((erpBudgets[1].body.accounts as unknown[]).length, 1);

    // The mirror FK stays the BARE uuid; the year is the row's own grain; the FR-BFY-080 span witness
    // is stamped from the gate's own re-read of the project (never NULL on a push that succeeded).
    const mirrors = mirrorUpserts(calls);
    assertEquals(mirrors.length, 2);
    for (const [fy, mirror] of [['2026', mirrors[0]], ['2027', mirrors[1]]] as const) {
      assertEquals(mirror.budget_version_id, VERSION_ID, 'mirror FK is the bare budget_version_id UUID');
      assertEquals(mirror.fiscal_year, fy);
      assertEquals(mirror.push_state, 'pushed');
      assertEquals(mirror.pushed_project_start_date, '2026-06-01');
      assertEquals(mirror.pushed_project_end_date, '2027-06-30');
    }

    // `external_refs` is keyed on the YEAR-QUALIFIED identity — a bare key would let year 2's push
    // repoint year 1's ERP pointer (and, after the re-key, pass the create guard as a duplicate).
    const refWrites = calls.filter((c) => c.url.pathname === '/rest/v1/rpc/record_outbox_ref');
    assertEquals(refWrites.length, 2);
    assertEquals(
      refWrites.map((c) => (c.bodyJson as { p_pmo_record_id: string }).p_pmo_record_id),
      [`${VERSION_ID}:${encodeFiscalYear('2026')}`, `${VERSION_ID}:${encodeFiscalYear('2027')}`],
    );

    // The GATE ran against the bare UUID (the mutation this pins: a year in `record.id` makes the
    // version read return nothing and every push die "version not readable").
    const versionReads = restCall(calls, 'budget_versions', 'GET');
    assert(versionReads.length >= 1);
    for (const read of versionReads) {
      assertEquals(read.url.searchParams.get('id'), `eq.${VERSION_ID}`);
    }
  });

  it('AC-BFY-009: a single-fiscal-year project still pushes exactly one year (FR-BFY-011 unchanged)', async () => {
    const seed = twoYearPhasedSeed({
      projectStartDate: '2026-02-01',
      projectEndDate: '2026-11-30',
      lineItems: [
        { id: 'li-1', category: 'Labor', budgeted_amount: '90000.00', fiscal_year: null },
        { id: 'li-2', category: 'Materials', budgeted_amount: '50000.00', fiscal_year: null },
      ],
    });
    const { res, calls, erpBudgets } = await runServed(seed);
    assertEquals(res.status, 200);
    assertEquals(erpBudgets.length, 1);
    const inserts = outboxInserts(calls);
    assertEquals(inserts.length, 1);
    assertEquals(inserts[0].pmo_record_id, `${VERSION_ID}:${encodeFiscalYear('2026')}`);
    // Both un-phased lines belong to the single year (FR-BFY-011).
    assertEquals((erpBudgets[0].body.accounts as unknown[]).length, 2);
  });

  it('AC-BFY-009: a multi-fiscal-year project with an UN-PHASED line is refused, and the refusal is F-B only', async () => {
    const seed = twoYearPhasedSeed({
      lineItems: [
        { id: 'li-1', category: 'Labor', budgeted_amount: '90000.00', fiscal_year: '2026' },
        { id: 'li-2', category: 'Materials', budgeted_amount: '50000.00', fiscal_year: null },
      ],
    });
    const { res, body, calls, erpBudgets } = await runServed(seed);
    assertEquals(res.status, 422);
    assert(String(body.message).includes('phase these lines'), body.message);
    assertEquals(erpBudgets.length, 0, 'a refused push touches ERP not at all');
    assertEquals(outboxInserts(calls).length, 0);
    // The refusal IS durable — a `failed` mirror row at the start-FY grain (FR-BFY-010). It records
    // F-B (an attempt), never a budget on record.
    const mirrors = mirrorUpserts(calls);
    assertEquals(mirrors.length, 1);
    assertEquals(mirrors[0].push_state, 'failed');
    assertEquals(mirrors[0].fiscal_year, '2026');
    assertEquals(mirrors[0].budget_version_id, VERSION_ID);
  });

  it('AC-BFY-009: when year 1 succeeds and year 2 is refused, year 1 stays pushed and year 2 is recorded failed', async () => {
    // Year 2's grain already holds TWO live Desk Budgets — genuine ambiguity the adapter refuses.
    const seed = twoYearPhasedSeed({
      grainByFiscalYear: {
        '2027': [
          { name: 'DESK-A', docstatus: 1, owner: 'accountant@client.test' },
          { name: 'DESK-B', docstatus: 1, owner: 'accountant@client.test' },
        ],
      },
    });
    const { res, calls, erpBudgets } = await runServed(seed);
    assertEquals(res.status, 422);
    // Year 1 reached ERP and is enforcing; year 2 never did.
    assertEquals(erpBudgets.length, 1);
    assertEquals(erpBudgets[0].body.fiscal_year, '2026');
    const mirrors = mirrorUpserts(calls);
    assertEquals(mirrors.filter((m) => m.fiscal_year === '2026' && m.push_state === 'pushed').length, 1);
    const failed = mirrors.filter((m) => m.fiscal_year === '2027' && m.push_state === 'failed');
    assertEquals(failed.length, 1, 'the failure writer stamps the SPECIFIC failing year, never the start FY');
  });

  it('AC-1714: a mid-plan unowned live occupant fails ONLY its year — the later year still pushes under its own command', async () => {
    // Year 2026's grain holds an accountant-authored live Budget PMO does not own; 2027 is free.
    const seed = twoYearPhasedSeed({
      grainByFiscalYear: {
        '2026': [{ name: 'DESK-BUDGET-1', docstatus: 1, amended_from: null, owner: 'accountant@client.test' }],
      },
    });
    const { res, body, calls, erpBudgets } = await runServed(seed);
    assertEquals(res.status, 422);
    assertEquals(body.error, 'budget-unowned-live-occupant');
    // Continuation: the fan-out still attempted EVERY year, each under ITS OWN command — 2027 reached
    // ERP and pushed even though 2026 was refused first.
    assertEquals(erpBudgets.map((b) => b.body.fiscal_year), ['2027']);
    const mirrors = mirrorUpserts(calls);
    assertEquals(
      mirrors.filter((m) => m.fiscal_year === '2026' && m.push_state === 'failed').length,
      1,
      'the failure writer stamps the failing year 2026, not the later year',
    );
    assertEquals(
      mirrors.filter((m) => m.fiscal_year === '2027' && m.push_state === 'pushed').length,
      1,
      'year 2027 is recorded pushed',
    );
    const identities = outboxInserts(calls).map((i) => i.pmo_record_id);
    assert(
      identities.includes(`${VERSION_ID}:${encodeFiscalYear('2027')}`),
      `the outbox includes 2027's year-qualified identity; saw: ${JSON.stringify(identities)}`,
    );
  });
});

describe('AC-BFY-009 — cross-org / identity guards still hold', () => {
  it('AC-BFY-009: the served key guard accepts the server-derived 4-segment budget key', async () => {
    const { res } = await runServed(twoYearPhasedSeed());
    assertEquals(res.status, 200, 'the derived bud:<vid>:<encoded-fy>:<epoch> key passes the boundary guard');
  });

  it('AC-BFY-009: the project link is re-read for the cross-org pre-flight on every year', async () => {
    const { calls } = await runServed(twoYearPhasedSeed());
    const projectReads = restCall(calls, 'projects', 'GET');
    assert(projectReads.length >= 2, 'the adapter re-resolves its refs per year');
    for (const read of projectReads) {
      assertEquals(read.url.searchParams.get('id'), `eq.${PROJECT_ID}`);
    }
  });
});

describe('AC-BFY-009 — org scoping', () => {
  it('AC-BFY-009: every outbox row and mirror row carries the caller org resolved from the JWT', async () => {
    const { calls } = await runServed(twoYearPhasedSeed());
    for (const insert of outboxInserts(calls)) assertEquals(insert.org_id, ORG_ID);
    for (const mirror of mirrorUpserts(calls)) assertEquals(mirror.org_id, ORG_ID);
  });

  it('AC-BFY-009: a stored private ERP destination is refused before any outbound request', async () => {
    const { routes } = servedRoutes(twoYearPhasedSeed(), 15, 'https://127.0.0.1');
    await withFetchMock(routes, async ({ calls }) => {
      const response = await dispatchBudget();
      assert(response.status >= 400, 'the served dispatch refuses the private ERP destination');
      assertEquals(calls.filter((call) => call.url.hostname === '127.0.0.1').length, 0,
        `no outbound request reaches the stored private destination: ${calls.map((call) => call.url.toString()).join(', ')}`);
    });
  });
});

describe('AC-1714 — the shipped ERP binding resolver guard fails closed', () => {
  /** Drive the SHIPPED handler with the binding resolver's 5-column read answered by `resolverResponse`
   *  (a PostgREST error, or a 200-null empty read). The route is PREPENDED (first matching route wins)
   *  and keyed on URL search parameters — never a fragile read count: the `select=activated_at`
   *  employment read still gets the fixture's valid active row, so only the resolver read fails. */
  async function runWithBindingResolverAnswering(resolverResponse: () => Response) {
    const { routes, erpBudgets } = servedRoutes(twoYearPhasedSeed());
    const resolverCalls: FetchCall[] = [];
    const bindingRoute = supabaseSelect('external_org_bindings', (call) => {
      const select = (call.url.searchParams.get('select') ?? '').replace(/\s+/g, '');
      if (select === 'activated_at') {
        return jsonResponse({
          site_url: ERP_SITE_URL,
          secret_ref: SECRET_REF,
          activated_at: '2026-01-01T00:00:00+00:00',
          version_major: 15,
          config: {},
        });
      }
      resolverCalls.push(call);
      return resolverResponse();
    });
    return await withFetchMock([bindingRoute, ...routes], async ({ calls }) => {
      const res = await dispatchBudget();
      return { res, body: await res.json(), calls, erpBudgets, resolverCalls };
    });
  }

  /** Both failure shapes must reach the SAME guard: the resolver query actually ran, scoped to this
   *  org and tier, and the dispatch refuses before any outbox row or ERP call. */
  function assertGuardReached(
    outcome: Awaited<ReturnType<typeof runWithBindingResolverAnswering>>,
  ): void {
    const { res, body, calls, resolverCalls, erpBudgets } = outcome;
    assertEquals(resolverCalls.length, 1, 'the resolver query actually occurred');
    assertEquals(resolverCalls[0].url.searchParams.get('org_id'), `eq.${ORG_ID}`);
    assertEquals(resolverCalls[0].url.searchParams.get('external_tier'), 'eq.erpnext');
    assertEquals(
      (resolverCalls[0].url.searchParams.get('select') ?? '').replace(/\s+/g, ''),
      'site_url,secret_ref,version_major,config,activated_at',
      'the failing read is the binding resolver\'s 5-column read',
    );

    assertEquals(res.status, 422);
    assertEquals(body, { error: 'commit-rejected', message: 'no erpnext binding configured for this org' });
    assertEquals(outboxInserts(calls).length, 0, 'no outbox POST');
    assertEquals(
      calls.filter((c) => c.url.host === ERP_HOST).length,
      0,
      'no calls to the ERP host',
    );
    assertEquals(erpBudgets.length, 0);
  }

  it('AC-1714: a PostgREST error on the binding resolver read fails closed — no outbox row, no ERP call', async () => {
    assertGuardReached(await runWithBindingResolverAnswering(() => jsonResponse({ code: 'XX000', message: 'test failure' }, { status: 500 })));
  });

  it('AC-1714: an empty binding read (HTTP 200 null) fails closed with the same gate message', async () => {
    assertGuardReached(await runWithBindingResolverAnswering(() => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } })));
  });
});
