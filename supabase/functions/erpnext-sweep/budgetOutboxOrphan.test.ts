/**
 * ⚑ MEDIUM-2 (money-safety audit round 5) — A BUDGET PUSH THAT CRASHED BETWEEN THE ERP WRITE AND THE
 * FINALIZE WAS OWNED BY NO RECOVERY PASS.
 *
 * The budget domain has exactly two passes and neither could see this row:
 *   • pass 1 (`reconcileOrgOutbox`) SKIPS the budget domain unconditionally (deliberately — pass 5 is
 *     the single owner, because only pass 5 re-asserts that the version is still `Active`);
 *   • pass 5's work queue was `budget_version_erp_mirror` rows in `pending`/`failed`, and NOTHING writes
 *     a mirror row before the dispatch — every mirror writer lives inside `adapter-dispatch`'s finalize.
 *
 * So a dispatch that died after `adapter.commit` and before `finalize_outbox` left an outbox row
 * `committing`/`quarantined`, NO mirror row and NO `external_refs` row: `get_budget_projection` reported
 * `'never-pushed'` while ERPNext held a live, submitted Budget — and, with the FR-BUD-121 upsert, while
 * the PREVIOUS budget was already a cancelled tombstone.
 *
 * The fix is the one the audit named: pass 5 unions the budget-domain rows `outbox_reconcile_candidates`
 * STILL ADMITS (0131's one eligibility door — not a second door), keyed on the outbox rather than only on
 * the mirror. Every gate stays in force: the version is re-read and must still be `Active`, and the row
 * must still be admitted by 0131.
 *
 * Verify: deno test supabase/functions/erpnext-sweep/budgetOutboxOrphan.test.ts --config supabase/functions/erpnext-sweep/deno.json
 */
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { budgetBackstopDepsLive } = await import('./index.ts');
import type { SupabaseClient } from '@supabase/supabase-js';
import { encodeFiscalYear } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/fiscalYearEncoding.ts';

/** A year-qualified outbox identity `<budget_version_id>:<encoded_fy>` (FR-BFY-032). */
function qualified(versionId: string, fiscalYear: string): string {
  return `${versionId}:${encodeFiscalYear(fiscalYear)}`;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const ORG = '00000000-0000-4000-8000-0000000000aa';
const ORPHAN_VERSION = '0b3e3333-0000-0000-0000-000000000001';
const MIRRORED_VERSION = '0b3e3333-0000-0000-0000-000000000002';

const ORG_BINDING = {
  orgId: ORG,
  siteUrl: 'https://erp.example.test',
  secretRef: 'orphan-bench',
  company: 'PMO Smoke Co',
  config: {},
  ownedDomains: ['budget'],
  versionMajor: 15,
};

interface Write { table: string; op: string; payload: Record<string, unknown>; filters: Filters }
interface Filters { eq: Array<[string, unknown]>; in?: [string, unknown[]]; is?: [string, unknown] }

/**
 * ⚑ BLOCK 1 (FU-2 round 2) — THE FAKE USED TO DEFINE `eq: () => builder`, SO NO ASSERTION IN THIS FILE
 * COULD SEE A MISSING PREDICATE.
 *
 * It recorded only the write PAYLOAD and returned every mirror row for every query, which made it
 * structurally blind to exactly the defect class this module keeps producing: a mutation keyed on
 * `budget_version_id` alone when the table's grain is `(budget_version_id × fiscal_year)`. A hold meant
 * for FY2027 then also parked FY2026 — and `listPendingBudgetPushes` excludes `held`, so the other
 * year's recoverable push left the backstop queue for good.
 *
 * So the fake now APPLIES its filters, the way `erpnextFeedDeps.test.ts`'s `statefulBudgetClient` does:
 * `eq`/`in`/`is` select the mirror rows a query matches, and an `update` MUTATES exactly those rows in
 * place. Dropping a predicate is therefore observable as a row that changed and should not have.
 * (`org_id` is exempt — these fixtures model the org via `ORG_BINDING`, not a column.)
 */
function fakeDb(
  mirrorRows: Array<Record<string, unknown>>,
  opts: { outboxRow?: Record<string, unknown> | null } = {},
) {
  const writes: Write[] = [];
  const client = {
    from(table: string) {
      const eq: Array<[string, unknown]> = [];
      let inVal: [string, unknown[]] | undefined;
      let isVal: [string, unknown] | undefined;
      const filters = (): Filters => ({ eq: [...eq], in: inVal, is: isVal });
      const matchesMirror = (row: Record<string, unknown>): boolean =>
        eq.every(([c, v]) => c === 'org_id' || row[c] === v)
        && (!inVal || (inVal[1] as unknown[]).includes(row[inVal[0]]))
        && (!isVal || row[isVal[0]] === isVal[1]);
      const rowsFor = (): Array<Record<string, unknown>> =>
        table === 'budget_version_erp_mirror' ? mirrorRows.filter(matchesMirror) : [];
      // deno-lint-ignore no-explicit-any
      const builder: any = {
        select: () => builder,
        eq: (col: string, val: unknown) => { eq.push([col, val]); return builder; },
        is: (col: string, val: unknown) => { isVal = [col, val]; return builder; },
        in: (col: string, vals: unknown[]) => { inVal = [col, vals]; return builder; },
        not: () => builder,
        order: () => builder,
        limit: () => Promise.resolve({ data: rowsFor(), error: null }),
        contains: () => builder,
        maybeSingle: () => Promise.resolve({
          data: table === 'external_command_outbox' ? (opts.outboxRow ?? null) : (rowsFor()[0] ?? null),
          error: null,
        }),
        single: () => Promise.resolve({ data: rowsFor()[0] ?? null, error: null }),
        insert: (payload: Record<string, unknown>) => {
          writes.push({ table, op: 'insert', payload, filters: filters() });
          return Promise.resolve({ data: null, error: null });
        },
        update: (payload: Record<string, unknown>) => {
          // The write is recorded when the chain RESOLVES, so its filters are complete.
          builder.__update = payload;
          return builder;
        },
        upsert: (payload: Record<string, unknown>) => {
          writes.push({ table, op: 'upsert', payload, filters: filters() });
          return Promise.resolve({ data: null, error: null });
        },
        then: (resolve: (v: { data: unknown; error: null }) => unknown) => {
          const patch = builder.__update as Record<string, unknown> | undefined;
          if (patch) {
            writes.push({ table, op: 'update', payload: patch, filters: filters() });
            // The mutation the real UPDATE would perform — on exactly the rows its filters match.
            if (table === 'budget_version_erp_mirror') for (const row of rowsFor()) Object.assign(row, patch);
          }
          return Promise.resolve({ data: patch ? null : rowsFor(), error: null }).then(resolve);
        },
      };
      return builder;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
  return { client: client as unknown as SupabaseClient, writes };
}

Deno.test('⚑ MEDIUM-2: a budget outbox row with NO mirror row (crashed between the ERP commit and the finalize) IS queued by the backstop', async () => {
  const { client } = fakeDb([]);
  const deps = budgetBackstopDepsLive(client, ORG_BINDING, [
    { id: 'outbox-orphan', pmo_record_id: ORPHAN_VERSION },
  ]);
  const rows = await deps.listPendingBudgetPushes(ORG, 200);
  assert(
    rows.length === 1 && rows[0].budget_version_id === ORPHAN_VERSION,
    `the orphaned budget command must be queued — otherwise ERPNext holds a Budget PMO reports as never-pushed. Got ${JSON.stringify(rows)}`,
  );
  assert(rows[0].push_state === 'absent', `an outbox-only candidate is queued as 'absent', got ${rows[0].push_state}`);
});

Deno.test('⚑ BLOCKER 3 (FU-2): the SAME (version, fiscal_year) that already has a mirror row is never double-queued (the mirror row is the newer truth)', async () => {
  // Dedup is by (budget_version_id, fiscal_year), not version alone. Here the outbox orphan names the
  // SAME year the mirror already holds, so the mirror row wins and no duplicate 'absent' is queued.
  const { client } = fakeDb([{ budget_version_id: MIRRORED_VERSION, push_state: 'failed', erp_cancelled_at: null, fiscal_year: '2026' }]);
  const deps = budgetBackstopDepsLive(client, ORG_BINDING, [
    { id: 'outbox-mirrored', pmo_record_id: qualified(MIRRORED_VERSION, '2026') },
  ]);
  const rows = await deps.listPendingBudgetPushes(ORG, 200);
  assert(rows.length === 1, `expected exactly one queued row, got ${JSON.stringify(rows)}`);
  assert(rows[0].push_state === 'failed', `the MIRROR row wins for its own year — it carries the recorded failure history, got ${rows[0].push_state}`);
});

Deno.test('⚑ BLOCKER 3 (FU-2): a crashed FY2027 push is reconciled even when FY2026 already has a mirror row for the SAME version', async () => {
  // The multi-FY recovery case the version-only dedup silently dropped: FY2026 is mirrored, but FY2027
  // reached ERP and crashed before its own mirror/external_refs finalize. Suppressing it because a
  // DIFFERENT year of the same version has a mirror leaves a live ERP Budget PMO reports as never-pushed.
  //
  // ⚑ FY2026 is `failed`, not `pushed`: now that the fake honours `.in('push_state', …)`, a `pushed`
  // row is not returned by `listPendingBudgetPushes` at all, so it would populate neither dedup set and
  // the assertion below would hold even under the version-only dedup it exists to forbid.
  const { client } = fakeDb([{ budget_version_id: MIRRORED_VERSION, push_state: 'failed', erp_cancelled_at: null, fiscal_year: '2026' }]);
  const deps = budgetBackstopDepsLive(client, ORG_BINDING, [
    { id: 'outbox-fy2027-orphan', pmo_record_id: qualified(MIRRORED_VERSION, '2027') },
  ]);
  const rows = await deps.listPendingBudgetPushes(ORG, 200);
  const orphan = rows.find((r) => r.push_state === 'absent');
  assert(!!orphan, `the FY2027 orphan MUST be queued for reconciliation — got ${JSON.stringify(rows)}`);
  assert(orphan!.budget_version_id === MIRRORED_VERSION, `queued under its version, got ${JSON.stringify(orphan)}`);
  assert(orphan!.fiscal_year === '2027', `the orphan carries its own year (FY2027), got ${JSON.stringify(orphan)}`);
});

Deno.test('⚑ MEDIUM-2: only rows 0131 STILL ADMITS are unioned in — an attempt-exhausted outbox row is NOT resurrected by the orphan queue', async () => {
  // The eligibility set IS `outbox_reconcile_candidates` (H-1's one door). An empty set means every
  // budget outbox row is committed-already / attempt-exhausted / quarantined-not-due / too old.
  const { client } = fakeDb([]);
  const deps = budgetBackstopDepsLive(client, ORG_BINDING, []);
  const rows = await deps.listPendingBudgetPushes(ORG, 200);
  assert(rows.length === 0, `no eligible outbox row ⇒ nothing to queue, got ${JSON.stringify(rows)}`);
});

Deno.test('⚑ MEDIUM-2: an `absent` candidate refused by the re-asserted gate has its refusal INSERTED — a compare-and-set would record nothing at all', async () => {
  // With no mirror row there is nothing to UPDATE, so the update-only hold wrote zero rows and the
  // refusal was invisible: the very outcome (a stranded budget nobody can see) this pass exists to end.
  const { client, writes } = fakeDb([]);
  const deps = budgetBackstopDepsLive(client, ORG_BINDING, []);
  await deps.driveBudgetPush(
    // LOW-1: the grain the hold is ABOUT. `budget_version_erp_mirror.fiscal_year` is NOT NULL, so a
    // candidate that cannot state it cannot be held at all (see the LOW-1 tests below).
    { budget_version_id: ORPHAN_VERSION, push_state: 'absent', erp_cancelled_at: null, fiscal_year: '2026' },
    { id: ORPHAN_VERSION, status: 'Active', activated_at: '2026-07-20T00:00:00.000Z' },
  );
  const parked = writes.find((w) => w.table === 'budget_version_erp_mirror');
  assert(parked?.op === 'insert', `an absent candidate has no row to update — the refusal must be INSERTED, got ${parked?.op}`);
  assert(parked!.payload.push_state === 'held', `the dead end is recorded as held, got ${JSON.stringify(parked!.payload)}`);
  assert(
    parked!.payload.push_error === 'budget-push-no-outbox-candidate',
    `the reason is recorded verbatim, got ${JSON.stringify(parked!.payload.push_error)}`,
  );
});

/**
 * ⚑ LOW-1 (money-safety audit round 6) — THE RECOVERY INSERT WAS DEAD ON ARRIVAL.
 *
 * `budget_version_erp_mirror.fiscal_year` is `text NOT NULL` with no default (0137 §1) and
 * `stamp_org_id` stamps only `org_id`, so the `absent` branch's insert — which omitted it entirely —
 * raises 23502. The guard absorbs only 23505, so `driveBudgetPush` throws and the per-row containment
 * records an error INSTEAD of the durable `held` state the branch exists to write. The unit fake could
 * not see it because it models no constraints; so the CONTRACT is asserted here instead: the payload
 * must carry the grain's fiscal year, and it must never carry an invented one.
 *
 * ⚑ And it may not be invented, for a reason that did not exist when this code was written: since
 * HIGH-1, `budget_version_erp_mirror.fiscal_year` is the AUTHORITY `get_budget_projection` scopes the
 * PMO budget column by. A fabricated year here would put a wrong-year budget on the primary money
 * screen — the exact defect HIGH-1 removed, re-introduced through a recovery path.
 */
Deno.test('⚑ LOW-1: the `absent` hold carries the grain\'s fiscal year — the column is NOT NULL, so an omitted one is a 23502, not a hold', async () => {
  const { client, writes } = fakeDb([]);
  const deps = budgetBackstopDepsLive(client, ORG_BINDING, []);
  await deps.driveBudgetPush(
    { budget_version_id: ORPHAN_VERSION, push_state: 'absent', erp_cancelled_at: null, fiscal_year: '2025-2026' },
    { id: ORPHAN_VERSION, status: 'Active', activated_at: '2026-07-20T00:00:00.000Z' },
  );
  const parked = writes.find((w) => w.table === 'budget_version_erp_mirror');
  assert(parked?.op === 'insert', `expected an insert, got ${JSON.stringify(parked)}`);
  assert(
    parked!.payload.fiscal_year === '2025-2026',
    `the hold must state the grain it holds — got ${JSON.stringify(parked!.payload)}`,
  );
});

Deno.test('⚑ LOW-1: with NO fiscal year knowable, NO mirror row is fabricated — and the pass does not throw, so the action-required surface still runs', async () => {
  const { client, writes } = fakeDb([]);
  const deps = budgetBackstopDepsLive(client, ORG_BINDING, []);
  // Not throwing is half the assertion: the pre-fix insert raised 23502, the guard absorbed only 23505,
  // so `driveBudgetPush` threw — and the throw happened BEFORE the call site's `surfaceActionRequired`,
  // which is the only remaining way an operator hears about a stranded push with no knowable grain.
  await deps.driveBudgetPush(
    { budget_version_id: ORPHAN_VERSION, push_state: 'absent', erp_cancelled_at: null },
    { id: ORPHAN_VERSION, status: 'Active', activated_at: '2026-07-20T00:00:00.000Z' },
  );
  assert(
    !writes.some((w) => w.table === 'budget_version_erp_mirror'),
    `a mirror row with a guessed fiscal year would mis-scope the budget projection — none may be written: ${JSON.stringify(writes)}`,
  );
});

/**
 * ⚑ BLOCK 1 (FU-2 round 2) — ONE YEAR'S HOLD MUST NOT PARK EVERY OTHER YEAR OF THE SAME VERSION.
 *
 * `budget_version_erp_mirror`'s grain is `(budget_version_id × fiscal_year)`, and a hold is a statement
 * about ONE year: "this year's push has run out of automatic recovery". Keyed on the version alone, the
 * compare-and-set matched every `pending`/`failed` row of the version — so exhausting FY2027's attempts
 * also stamped FY2026 `held` with FY2027's reason. `listPendingBudgetPushes` excludes `held`, so FY2026
 * left the backstop's work queue permanently: ERPNext holds no overspend control for that year and
 * nothing will ever install one, while `hold_releasable` is false for it (its own outbox row is not
 * `held`), so the operator is not offered the Release affordance either.
 *
 * Mutation proof: delete `.eq('fiscal_year', fiscalYear)` from `holdBudgetMirrorRow`'s UPDATE and this
 * test fails on the FY2026 assertions.
 */
Deno.test('⚑ BLOCK 1: exhausting FY2027\'s attempts holds ONLY FY2027 — the still-recoverable FY2026 row is untouched', async () => {
  const fy2026 = { budget_version_id: MIRRORED_VERSION, push_state: 'failed', push_error: 'erp-unreachable', erp_cancelled_at: null, fiscal_year: '2026' };
  const fy2027 = { budget_version_id: MIRRORED_VERSION, push_state: 'failed', push_error: 'erp-unreachable', erp_cancelled_at: null, fiscal_year: '2027' };
  // An outbox row EXISTS for FY2027 but 0131 no longer admits it (the eligible set is empty) and it is
  // neither `committing` nor `quarantined` — the attempts-exhausted branch, verbatim.
  const { client } = fakeDb([fy2026, fy2027], {
    outboxRow: {
      id: 'outbox-fy2027', domain: 'budget', pmo_record_id: qualified(MIRRORED_VERSION, '2027'),
      idempotency_key: 'k', state: 'failed', external_record_id: null, canonical: null,
      claim_generation: 1, payload_digest: null,
    },
  });
  const deps = budgetBackstopDepsLive(client, ORG_BINDING, []);

  await deps.driveBudgetPush(
    { budget_version_id: MIRRORED_VERSION, push_state: 'failed', erp_cancelled_at: null, fiscal_year: '2027' },
    { id: MIRRORED_VERSION, status: 'Active', activated_at: '2026-07-20T00:00:00.000Z' },
  );

  assert(fy2027.push_state === 'held', `the exhausted FY2027 row IS held, got ${JSON.stringify(fy2027)}`);
  assert(fy2027.push_error === 'budget-push-attempts-exhausted', `with its own reason, got ${JSON.stringify(fy2027)}`);
  assert(
    fy2026.push_state === 'failed',
    `BLOCK 1: FY2026 is still recoverable and MUST stay in the backstop queue — 'held' removes it forever. Got ${JSON.stringify(fy2026)}`,
  );
  assert(
    fy2026.push_error === 'erp-unreachable',
    `BLOCK 1: FY2026 must not carry FY2027's reason. Got ${JSON.stringify(fy2026)}`,
  );
});

Deno.test('⚑ BLOCK 1: the no-outbox-candidate hold is year-scoped too — the same CAS, the same grain', async () => {
  const fy2026 = { budget_version_id: MIRRORED_VERSION, push_state: 'pending', push_error: null as string | null, erp_cancelled_at: null, fiscal_year: '2026' };
  const fy2027 = { budget_version_id: MIRRORED_VERSION, push_state: 'failed', push_error: null as string | null, erp_cancelled_at: null, fiscal_year: '2027' };
  const { client } = fakeDb([fy2026, fy2027]); // no outbox row at all ⇒ 'budget-push-no-outbox-candidate'
  const deps = budgetBackstopDepsLive(client, ORG_BINDING, []);

  await deps.driveBudgetPush(
    { budget_version_id: MIRRORED_VERSION, push_state: 'failed', erp_cancelled_at: null, fiscal_year: '2027' },
    { id: MIRRORED_VERSION, status: 'Active', activated_at: '2026-07-20T00:00:00.000Z' },
  );

  assert(fy2027.push_state === 'held', `FY2027 is held, got ${JSON.stringify(fy2027)}`);
  assert(fy2026.push_state === 'pending', `BLOCK 1: FY2026's queued push must be untouched, got ${JSON.stringify(fy2026)}`);
});

/** ⚑ BLOCK 1 — with no knowable year there is no grain to hold, so the UPDATE must not run at all
 *  (the INSERT branch already takes that posture). A version-wide `held` write is exactly the damage. */
Deno.test('⚑ BLOCK 1: a candidate with NO fiscal year holds NOTHING — never a version-wide update', async () => {
  const fy2026 = { budget_version_id: MIRRORED_VERSION, push_state: 'failed', push_error: null as string | null, erp_cancelled_at: null, fiscal_year: '2026' };
  const { client, writes } = fakeDb([fy2026]);
  const deps = budgetBackstopDepsLive(client, ORG_BINDING, []);

  await deps.driveBudgetPush(
    { budget_version_id: MIRRORED_VERSION, push_state: 'failed', erp_cancelled_at: null },
    { id: MIRRORED_VERSION, status: 'Active', activated_at: '2026-07-20T00:00:00.000Z' },
  );

  assert(
    !writes.some((w) => w.table === 'budget_version_erp_mirror'),
    `no year ⇒ no grain ⇒ no mirror write: ${JSON.stringify(writes)}`,
  );
  assert(fy2026.push_state === 'failed', `and FY2026 is untouched, got ${JSON.stringify(fy2026)}`);
});

/** The orphan queue must CARRY the fiscal year forward from the outbox row that knows it. */
Deno.test('⚑ LOW-1: the orphan queue carries the fiscal year the outbox canonical states', async () => {
  const { client } = fakeDb([]);
  const deps = budgetBackstopDepsLive(client, ORG_BINDING, [
    { id: 'outbox-orphan', pmo_record_id: ORPHAN_VERSION, fiscal_year: '2025-2026' },
  ]);
  const rows = await deps.listPendingBudgetPushes(ORG, 200);
  assert(rows[0].fiscal_year === '2025-2026', `the queued orphan must carry its grain, got ${JSON.stringify(rows[0])}`);
});
