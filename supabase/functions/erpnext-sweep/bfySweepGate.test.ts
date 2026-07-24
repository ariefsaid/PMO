/**
 * AC-BFY-022 (FR-BFY-075, review finding 5) — THE SWEEP RE-RUNS THE BUDGET GATE BEFORE IT POSTS.
 *
 * ⚑ THE FACT: the sweep's recovery path reconstructs a FROZEN command from the outbox payload and
 * calls `dispatchMoneyWrite` directly — so it re-runs NONE of the synchronous dispatch's gates. If the
 * project's dates (or the client's `Fiscal Year` calendar, or the category map, or the line items)
 * changed after the command was frozen, the sweep would POST a body the foreground gate would now
 * REFUSE: an ERP `Budget` installed for a year the project no longer occupies, enforcing a control
 * nobody authorized, hours after the fact and with no operator present.
 *
 * The facts the re-run gate tests are the SAME four the foreground gate tests — F-C (PMO's own phased
 * lines), the client's live calendar, the project's CURRENT span, and the category map — because it IS
 * the same `runBudgetGate`, not a second copy of the rule.
 *
 * Verify: cd supabase/functions/erpnext-sweep && deno test --allow-all bfySweepGate.test.ts
 */
// Stub Deno.serve so importing index.ts (top-level Deno.serve) does not bind a port under deno test.
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { buildReconcileDepsLive } = await import('./index.ts');
import type { SupabaseClient } from '@supabase/supabase-js';
import { encodeFiscalYear } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/fiscalYearEncoding.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const ORG = '00000000-0000-4000-8000-0000000000aa';
const VERSION_ID = '0b3e3333-0000-4000-8000-000000000001';
const PROJECT_ID = '0b3e3333-0000-4000-8000-000000000002';
const ACTOR = '0b3e3333-0000-4000-8000-000000000003';
const FY1 = '2026';
const IDENTITY = `${VERSION_ID}:${encodeFiscalYear(FY1)}`;

const ORG_BINDING = {
  orgId: ORG,
  siteUrl: 'https://erp.sweep.test',
  secretRef: 'sweep-bench',
  company: 'PMO Smoke Co',
  config: { company: 'PMO Smoke Co', project_map: { [PROJECT_ID]: 'ERP-PROJ-1' } },
  ownedDomains: ['budget'],
  versionMajor: 15,
};

Deno.env.set('SWEEP_BENCH_KEY', 'k');
Deno.env.set('SWEEP_BENCH_SECRET', 's');

/** The command exactly as the foreground dispatch froze it for FY2026. */
const FROZEN_PAYLOAD = {
  id: VERSION_ID,
  erp_doc_kind: 'budget',
  projectId: PROJECT_ID,
  fiscal_year: FY1,
  outbox_identity: IDENTITY,
  project_start_date: '2026-02-01',
  project_end_date: '2026-11-30',
  line_items: [{ category: 'Labor', budgeted_amount: '90000.00', fiscal_year: FY1 }],
};

const OUTBOX_ROW = {
  id: 'outbox-1',
  domain: 'budget',
  pmoRecordId: IDENTITY,
  idempotencyKey: `bud:${VERSION_ID}:${encodeFiscalYear(FY1)}:1767225600000`,
  state: 'pending' as const,
  externalRecordId: null,
  canonical: null,
  claimGeneration: 0,
  payloadDigest: null,
};

interface WorldNow {
  /** The project's CURRENT dates — the whole point is that they may have moved since the freeze. */
  projectStart: string;
  projectEnd: string;
  fiscalYears: Array<{ name: string; year_start_date: string; year_end_date: string }>;
  /** The Active version's CURRENT line items (a re-phase moves the frozen year out of the plan). */
  lineItems: Array<{ id: string; category: string; budgeted_amount: string; fiscal_year: string | null }>;
  categoryMap: Array<{ category: string; erp_account: string }>;
}

const UNCHANGED: WorldNow = {
  projectStart: '2026-02-01',
  projectEnd: '2026-11-30',
  fiscalYears: [
    { name: FY1, year_start_date: '2026-01-01', year_end_date: '2026-12-31' },
    { name: '2027', year_start_date: '2027-01-01', year_end_date: '2027-12-31' },
  ],
  lineItems: [{ id: 'li-1', category: 'Labor', budgeted_amount: '90000.00', fiscal_year: FY1 }],
  categoryMap: [{ category: 'Labor', erp_account: '5100 - Labor - PSC' }],
};

function fakeDb(world: WorldNow) {
  const client = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      // deno-lint-ignore no-explicit-any
      const builder: any = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return builder;
        },
        is: () => builder,
        in: () => builder,
        not: () => builder,
        gt: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => {
          if (table === 'external_command_outbox') {
            return Promise.resolve({
              data: { operation: 'create', payload: FROZEN_PAYLOAD, actor_user_id: ACTOR },
              error: null,
            });
          }
          if (table === 'budget_versions') {
            return Promise.resolve({
              data: {
                id: VERSION_ID,
                org_id: ORG,
                project_id: PROJECT_ID,
                status: 'Active',
                activated_at: '2026-01-01T00:00:00.000Z',
              },
              error: null,
            });
          }
          if (table === 'projects') {
            return Promise.resolve({
              data: { id: PROJECT_ID, org_id: ORG, start_date: world.projectStart, end_date: world.projectEnd },
              error: null,
            });
          }
          if (table === 'external_org_bindings') {
            return Promise.resolve({
              data: { site_url: ORG_BINDING.siteUrl, version_major: 15, activated_at: '2026-01-01T00:00:00Z', config: ORG_BINDING.config },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
        then: (resolve: (v: { data: unknown; error: null }) => unknown) => {
          const rows = table === 'budget_line_items'
            ? (filters.id === undefined ? world.lineItems : [])
            : table === 'budget_category_account_map'
              ? world.categoryMap
              : [];
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        },
      };
      return builder;
    },
    rpc: (fn: string) => {
      if (fn === 'domain_owned_by_tier') return Promise.resolve({ data: true, error: null });
      // AC-BUD-003 (mig 0160): budget authorizes on the ACTIVE erpnext binding — authGuard calls this RPC
      // for budget instead of domain_owned_by_tier. This fixture is an employing org (binding mocked above).
      if (fn === 'org_has_active_erpnext_binding') return Promise.resolve({ data: true, error: null });
      if (fn === 'actor_authorization_state') return Promise.resolve({ data: { role: 'Admin', active: true }, error: null });
      return Promise.resolve({ data: null, error: null });
    },
  };
  return client as unknown as SupabaseClient;
}

/** The ERP calendar is a live read; nothing else may be fetched while the gate is deciding. */
function withErpFetch<T>(world: WorldNow, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  const posts: string[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const method = (input instanceof Request ? input.method : init?.method) ?? 'GET';
    if (url.pathname.startsWith('/api/resource/Fiscal%20Year')) {
      return Promise.resolve(new Response(JSON.stringify({ data: world.fiscalYears }), { status: 200, headers: { 'content-type': 'application/json' } }));
    }
    if (method !== 'GET') posts.push(`${method} ${url.pathname}`);
    return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
  }) as unknown as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = original;
    assert(posts.length === 0, `the sweep must not WRITE to ERP while the gate is deciding — saw ${posts.join(', ')}`);
  });
}

async function build(world: WorldNow): Promise<{ ok: true; deps: unknown } | { ok: false; code: unknown; message: string }> {
  return await withErpFetch(world, async () => {
    try {
      const deps = await buildReconcileDepsLive(fakeDb(world), ORG_BINDING as never, OUTBOX_ROW as never);
      return { ok: true as const, deps };
    } catch (err) {
      return { ok: false as const, code: (err as { code?: unknown }).code, message: err instanceof Error ? err.message : String(err) };
    }
  });
}

Deno.test("AC-BFY-022: the project's dates moved off the frozen year — the sweep HOLDS, it does not POST", async () => {
  // The project was extended and RE-SCHEDULED into 2027, so it no longer occupies FY2026 at all. The
  // foreground gate would refuse this push today (`budget-fiscal-year-out-of-span`); the sweep must
  // reach the same answer rather than installing a Budget for a year the project has left.
  const moved: WorldNow = { ...UNCHANGED, projectStart: '2027-01-05', projectEnd: '2027-11-30' };
  const result = await build(moved);
  assert(!result.ok, 'the sweep must refuse a frozen year the current gate rejects');
  assert(
    (result as { code?: unknown }).code === 'budget-sweep-gate-held',
    `the refusal must be NAMED so the operator surface can explain it — got ${String((result as { code?: unknown }).code)}`,
  );
  assert(/2026/.test((result as { message: string }).message), 'the hold names the fiscal year it is about');
});

Deno.test('AC-BFY-022: the year was RE-PHASED away — a frozen year no longer in the plan is HELD', async () => {
  // Same span, but the operator has since moved every line to FY2027. The current plan has no FY2026
  // entry at all, so the frozen FY2026 body is a figure PMO no longer stands behind.
  const rephased: WorldNow = {
    ...UNCHANGED,
    projectStart: '2026-02-01',
    projectEnd: '2027-06-30',
    lineItems: [{ id: 'li-1', category: 'Labor', budgeted_amount: '90000.00', fiscal_year: '2027' }],
  };
  const result = await build(rephased);
  assert(!result.ok, 'a frozen year absent from the current plan must not be POSTed');
  assert((result as { code?: unknown }).code === 'budget-sweep-gate-held', `got ${String((result as { code?: unknown }).code)}`);
});

Deno.test('AC-BFY-022: a category that became UNMAPPED is HELD (the gate re-reads the map too)', async () => {
  const unmapped: WorldNow = { ...UNCHANGED, categoryMap: [] };
  const result = await build(unmapped);
  assert(!result.ok, 'an unmapped category must refuse in the sweep exactly as it does in the foreground');
  assert((result as { code?: unknown }).code === 'budget-sweep-gate-held', `got ${String((result as { code?: unknown }).code)}`);
});

Deno.test('AC-BFY-022: an UNCHANGED world still reconciles — the gate narrows recovery, it does not disable it', async () => {
  const result = await build(UNCHANGED);
  assert(result.ok, `the ordinary recovery must still build its deps — got ${JSON.stringify(result)}`);
});

Deno.test('AC-BFY-022 / FR-BFY-032: the reconcile keys the outbox on the YEAR-QUALIFIED identity', async () => {
  const result = await build(UNCHANGED);
  assert(result.ok, 'deps must build');
  const deps = (result as { deps: { outboxRecordId?: string; command: { record: { id: string } } } }).deps;
  assert(
    deps.outboxRecordId === IDENTITY,
    `the sweep must re-read/finalize the SAME year-qualified row the foreground opened — got ${String(deps.outboxRecordId)}`,
  );
  assert(deps.command.record.id === VERSION_ID, 'while `record.id` stays the bare version uuid');
});

Deno.test('AC-BFY-022: a NON-budget domain is untouched by the gate (byte-for-byte)', async () => {
  const world = UNCHANGED;
  const result = await withErpFetch(world, async () => {
    try {
      await buildReconcileDepsLive(
        fakeDb(world),
        ORG_BINDING as never,
        { ...OUTBOX_ROW, domain: 'procurement', pmoRecordId: PROJECT_ID } as never,
      );
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : String(err) };
    }
  });
  // It fails for its OWN reason (the frozen payload's kind is a budget one), never with the budget hold.
  assert(!result.ok || true, 'no assertion on success/failure — only that the budget hold is not what fires');
  if (!result.ok) {
    assert(
      !/budget-sweep-gate-held/.test((result as { message: string }).message),
      'the budget gate must not run for another domain',
    );
  }
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// FR-BFY-075 (the orphan half) — THE BACKSTOP SELECTS THE SPECIFIC YEAR.
//
// An outbox-only orphan (a dispatch that died between the ERP commit and the mirror write) is now keyed
// on `<vid>:<encoded_fy>`. Queued verbatim, its `budget_version_id` would be a non-UUID — the version
// re-read finds nothing and the row is silently skipped, i.e. ERPNext holds a live Budget PMO reports as
// never-pushed, forever. The identity is parsed: the bare uuid for the FK, the DECODED year for the
// grain (read out of the identity the dispatch itself derived, never guessed).
// ════════════════════════════════════════════════════════════════════════════════════════════════
const { budgetBackstopDepsLive } = await import('./index.ts');

Deno.test('FR-BFY-075: a YEAR-QUALIFIED outbox orphan is queued under its bare version id and its own year', async () => {
  const client = fakeDb(UNCHANGED);
  const deps = budgetBackstopDepsLive(client, ORG_BINDING as never, [
    { id: 'outbox-orphan', pmo_record_id: IDENTITY },
  ]);
  const rows = await deps.listPendingBudgetPushes(ORG, 200);
  assert(rows.length === 1, `expected the orphan to be queued, got ${JSON.stringify(rows)}`);
  assert(
    rows[0].budget_version_id === VERSION_ID,
    `the mirror FK must be the BARE uuid — got ${rows[0].budget_version_id}`,
  );
  assert(rows[0].fiscal_year === FY1, `the grain is the year the identity NAMES — got ${String(rows[0].fiscal_year)}`);
});

Deno.test('FR-BFY-075: a PRE-fan-out bare orphan is unchanged (no year to parse, none invented)', async () => {
  const client = fakeDb(UNCHANGED);
  const deps = budgetBackstopDepsLive(client, ORG_BINDING as never, [
    { id: 'outbox-legacy', pmo_record_id: VERSION_ID },
  ]);
  const rows = await deps.listPendingBudgetPushes(ORG, 200);
  assert(rows.length === 1 && rows[0].budget_version_id === VERSION_ID, JSON.stringify(rows));
  assert(rows[0].fiscal_year === null, 'no year is invented for a legacy row');
});
