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

interface Write { table: string; op: string; payload: Record<string, unknown> }

function fakeDb(mirrorRows: Array<Record<string, unknown>>) {
  const writes: Write[] = [];
  const client = {
    from(table: string) {
      // deno-lint-ignore no-explicit-any
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        in: () => builder,
        not: () => builder,
        order: () => builder,
        limit: () => builder,
        contains: () => builder,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        single: () => Promise.resolve({ data: null, error: null }),
        insert: (payload: Record<string, unknown>) => { writes.push({ table, op: 'insert', payload }); return Promise.resolve({ data: null, error: null }); },
        update: (payload: Record<string, unknown>) => { writes.push({ table, op: 'update', payload }); return builder; },
        upsert: (payload: Record<string, unknown>) => { writes.push({ table, op: 'upsert', payload }); return Promise.resolve({ data: null, error: null }); },
        then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
          Promise.resolve({ data: table === 'budget_version_erp_mirror' ? mirrorRows : [], error: null }).then(resolve),
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

Deno.test('⚑ MEDIUM-2: a version that ALREADY has a mirror row is never double-queued (the mirror row is the newer truth)', async () => {
  const { client } = fakeDb([{ budget_version_id: MIRRORED_VERSION, push_state: 'failed', erp_cancelled_at: null }]);
  const deps = budgetBackstopDepsLive(client, ORG_BINDING, [
    { id: 'outbox-mirrored', pmo_record_id: MIRRORED_VERSION },
  ]);
  const rows = await deps.listPendingBudgetPushes(ORG, 200);
  assert(rows.length === 1, `expected exactly one queued row, got ${JSON.stringify(rows)}`);
  assert(rows[0].push_state === 'failed', `the MIRROR row wins — it carries the recorded failure history, got ${rows[0].push_state}`);
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

/** The orphan queue must CARRY the fiscal year forward from the outbox row that knows it. */
Deno.test('⚑ LOW-1: the orphan queue carries the fiscal year the outbox canonical states', async () => {
  const { client } = fakeDb([]);
  const deps = budgetBackstopDepsLive(client, ORG_BINDING, [
    { id: 'outbox-orphan', pmo_record_id: ORPHAN_VERSION, fiscal_year: '2025-2026' },
  ]);
  const rows = await deps.listPendingBudgetPushes(ORG, 200);
  assert(rows[0].fiscal_year === '2025-2026', `the queued orphan must carry its grain, got ${JSON.stringify(rows[0])}`);
});
