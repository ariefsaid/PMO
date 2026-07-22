/**
 * ⚑ NEW-4 (Luna audit round 4, 2026-07-22) [Deno] — THE BACKSTOP MAY ONLY MARK A ROW IT STILL OWNS.
 *
 * `budgetBackstopDepsLive.driveBudgetPush` writes `push_state = 'held'` on two dead-end branches (no
 * outbox candidate at all; a candidate that `outbox_reconcile_candidates` no longer admits). Both
 * updates were keyed ONLY on `(org_id, budget_version_id)` — with NO precondition on the state they
 * believed they were transitioning FROM.
 *
 * The eligibility that justified the write was established by `listPendingBudgetPushes` earlier in the
 * SAME tick (`push_state in ('pending','failed')`, not tombstoned), and the foreground path runs
 * concurrently on the very same row. So between the list and the update, an operator's Retry (or the
 * activation consequence) can legitimately move the row to `committing` — or all the way to `pushed`
 * against a real ERPNext Budget. The unconditional write then RELABELS a live, successful push as
 * `held`: the money screen shows "ERPNext is still enforcing the previous budget" over a budget
 * ERPNext IS enforcing, and `held` is excluded from the backstop's own work queue, so nothing re-drives
 * it. A read-then-blind-write across a concurrent writer is a lost update, not a state machine.
 *
 * The fix is a compare-and-set: the update carries the SAME predicate the listing asserted, so a row
 * that has moved on is simply not matched. These tests drive the SHIPPED `budgetBackstopDepsLive`
 * against a fake DB that really APPLIES the filters, so the oracle is the row's final state — not the
 * shape of the query.
 *
 * Verify: deno test supabase/functions/erpnext-sweep/ --config supabase/functions/erpnext-sweep/deno.json
 */
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { budgetBackstopDepsLive } = await import('./index.ts');
import type { SupabaseClient } from '@supabase/supabase-js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const ORG = '00000000-0000-4000-8000-0000000000aa';
const VERSION = '0b3e2222-0000-0000-0000-000000000001';

interface MirrorRow extends Record<string, unknown> {
  org_id: string;
  budget_version_id: string;
  push_state: string;
  erp_cancelled_at: string | null;
}

/** Filters as (op, column, value) so the fake can really APPLY them — the point of the test is that
 *  an update whose predicate no longer matches changes NOTHING. */
type Filter = { op: 'eq' | 'is'; col: string; val: unknown } | { op: 'in'; col: string; val: unknown[] };

function matches(row: MirrorRow, filters: Filter[]): boolean {
  return filters.every((f) => {
    if (f.op === 'in') return (f.val as unknown[]).includes(row[f.col]);
    return row[f.col] === f.val;
  });
}

/** A Supabase stand-in with ONE real `budget_version_erp_mirror` row that updates honour predicates
 *  against, plus the empty reads the surrounding code needs. */
function fakeDb(mirror: MirrorRow, outboxRow: Record<string, unknown> | null) {
  const client = {
    from(table: string) {
      const filters: Filter[] = [];
      let patch: Record<string, unknown> | null = null;
      const data = table === 'external_command_outbox' ? outboxRow : table === 'profiles' ? [{ id: 'admin-1' }] : [];
      // deno-lint-ignore no-explicit-any
      const builder: any = {
        select: () => builder,
        eq: (col: string, val: unknown) => { filters.push({ op: 'eq', col, val }); return builder; },
        is: (col: string, val: unknown) => { filters.push({ op: 'is', col, val }); return builder; },
        in: (col: string, val: unknown[]) => { filters.push({ op: 'in', col, val }); return builder; },
        not: () => builder,
        order: () => builder,
        limit: () => builder,
        contains: () => builder,
        maybeSingle: () => Promise.resolve({ data, error: null }),
        single: () => Promise.resolve({ data, error: null }),
        insert: () => Promise.resolve({ data: null, error: null }),
        update: (p: Record<string, unknown>) => { patch = p; return builder; },
        upsert: () => Promise.resolve({ data: null, error: null }),
        then: (resolve: (v: { data: unknown; error: null }) => unknown) => {
          if (patch && table === 'budget_version_erp_mirror' && matches(mirror, filters)) Object.assign(mirror, patch);
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return builder;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
  return client as unknown as SupabaseClient;
}

const ORG_BINDING = {
  orgId: ORG,
  siteUrl: 'https://erp.example.test',
  secretRef: 'held-bench',
  company: 'PMO Smoke Co',
  config: {},
  ownedDomains: ['budget'],
  versionMajor: 15,
};

const CANDIDATE = { budget_version_id: VERSION, push_state: 'pending', erp_cancelled_at: null };
const ACTIVE_VERSION = { id: VERSION, status: 'Active', activated_at: '2026-07-20T00:00:00.000Z' };

Deno.test('NEW-4: a row the foreground path already PUSHED is never relabelled held (no-outbox-candidate branch)', async () => {
  // Concurrency: listed as `pending`, but by the time the backstop writes, the foreground activation
  // consequence has completed a REAL ERPNext Budget push.
  const mirror: MirrorRow = { org_id: ORG, budget_version_id: VERSION, push_state: 'pushed', erp_cancelled_at: null };
  const deps = budgetBackstopDepsLive(fakeDb(mirror, null), ORG_BINDING, []);
  await deps.driveBudgetPush(CANDIDATE, ACTIVE_VERSION);
  assert(
    mirror.push_state === 'pushed',
    `expected the live pushed state to survive, got '${mirror.push_state}' — relabelling a successful ` +
      "push as 'held' shows a false blocker over a budget ERPNext IS enforcing, and 'held' is excluded " +
      'from the backstop queue so nothing ever re-drives it',
  );
});

Deno.test('NEW-4: a row now COMMITTING is never relabelled held (its ERP write may be in flight)', async () => {
  const mirror: MirrorRow = { org_id: ORG, budget_version_id: VERSION, push_state: 'committing', erp_cancelled_at: null };
  const deps = budgetBackstopDepsLive(fakeDb(mirror, null), ORG_BINDING, []);
  await deps.driveBudgetPush(CANDIDATE, ACTIVE_VERSION);
  assert(mirror.push_state === 'committing', `expected 'committing' to survive, got '${mirror.push_state}'`);
});

Deno.test('NEW-4: a row an operator CANCELLED in the Desk is never relabelled held (never fight the operator)', async () => {
  const mirror: MirrorRow = { org_id: ORG, budget_version_id: VERSION, push_state: 'pending', erp_cancelled_at: '2026-07-21T00:00:00.000Z' };
  const deps = budgetBackstopDepsLive(fakeDb(mirror, null), ORG_BINDING, []);
  await deps.driveBudgetPush(CANDIDATE, ACTIVE_VERSION);
  assert(mirror.push_state === 'pending', `expected the tombstoned row untouched, got '${mirror.push_state}'`);
});

Deno.test('NEW-4: a row STILL pending IS held — the dead end is still recorded, never silently dropped', async () => {
  const mirror: MirrorRow = { org_id: ORG, budget_version_id: VERSION, push_state: 'pending', erp_cancelled_at: null };
  const deps = budgetBackstopDepsLive(fakeDb(mirror, null), ORG_BINDING, []);
  await deps.driveBudgetPush(CANDIDATE, ACTIVE_VERSION);
  assert(mirror.push_state === 'held', `expected 'held', got '${mirror.push_state}'`);
  assert(mirror.push_error === 'budget-push-no-outbox-candidate', `expected the dead-end reason, got ${JSON.stringify(mirror.push_error)}`);
});

Deno.test('NEW-4: the attempts-exhausted branch carries the SAME precondition (a pushed row survives)', async () => {
  // An outbox row EXISTS but `outbox_reconcile_candidates` no longer admits it (H-1's one door).
  const outbox = {
    id: 'outbox-1', domain: 'budget', pmo_record_id: VERSION, idempotency_key: 'k',
    state: 'failed', external_record_id: null, canonical: null, claim_generation: 0, payload_digest: null,
  };
  const pushed: MirrorRow = { org_id: ORG, budget_version_id: VERSION, push_state: 'pushed', erp_cancelled_at: null };
  const depsPushed = budgetBackstopDepsLive(fakeDb(pushed, outbox), ORG_BINDING, []);
  await depsPushed.driveBudgetPush(CANDIDATE, ACTIVE_VERSION);
  assert(pushed.push_state === 'pushed', `expected 'pushed' to survive, got '${pushed.push_state}'`);

  const pending: MirrorRow = { org_id: ORG, budget_version_id: VERSION, push_state: 'failed', erp_cancelled_at: null };
  const depsPending = budgetBackstopDepsLive(fakeDb(pending, outbox), ORG_BINDING, []);
  await depsPending.driveBudgetPush(CANDIDATE, ACTIVE_VERSION);
  assert(pending.push_state === 'held', `expected a still-eligible row to be held, got '${pending.push_state}'`);
  assert(pending.push_error === 'budget-push-attempts-exhausted', `expected the exhausted reason, got ${JSON.stringify(pending.push_error)}`);
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
// ⚑ NOT-ELIGIBLE-YET IS NOT ATTEMPTS-EXHAUSTED (found by the AC-BUD-032 e2e, audit round 5).
//
// `outbox_reconcile_candidates` (0131) answers "may this row be reconciled NOW". A row it omits is
// either finished with (confirmed), genuinely out of budget (attempt-exhausted / too old) — or simply
// NOT DUE YET: a `committing` row inside its 60 s lease, or a `quarantined` row before its visibility
// window elapses. Treating the last group as exhausted parked it `held`, and `held` is excluded from
// this queue, so the row NEVER came back — while the outbox row itself was about to become claimable.
//
// This is the ordinary shape of a transient ERP failure on the budget push: the dispatch marks NOTHING
// (deliberately — the row must stay reclaimable) and the very next cron tick, seconds later, saw a
// `failed` mirror row plus a not-yet-due outbox row and terminated the automatic recovery. It is exactly
// the recovery HIGH-1 depends on.
// ────────────────────────────────────────────────────────────────────────────────────────────────
for (const state of ['committing', 'quarantined'] as const) {
  Deno.test(`⚑ HIGH-1: an outbox row that is merely NOT DUE YET (${state}) is never parked held — a later tick owns it`, async () => {
    const outbox = {
      id: 'outbox-1', domain: 'budget', pmo_record_id: VERSION, idempotency_key: 'k',
      state, external_record_id: null, canonical: null, claim_generation: 0, payload_digest: null,
    };
    const mirror: MirrorRow = { org_id: ORG, budget_version_id: VERSION, push_state: 'failed', erp_cancelled_at: null };
    // The eligibility set is EMPTY — the RPC does not admit a fresh `committing`/not-due `quarantined` row.
    const deps = budgetBackstopDepsLive(fakeDb(mirror, outbox), ORG_BINDING, []);
    await deps.driveBudgetPush(CANDIDATE, ACTIVE_VERSION).catch(() => undefined);
    assert(
      mirror.push_state === 'failed',
      `a not-yet-due command must be left for a later tick, got '${mirror.push_state}' — 'held' is excluded from this queue, so it would end the automatic recovery for good`,
    );
  });
}

Deno.test('⚑ HIGH-1: a genuinely attempt-exhausted row (a `failed` command 0131 no longer admits) IS still held — the bound is not weakened', async () => {
  const outbox = {
    id: 'outbox-1', domain: 'budget', pmo_record_id: VERSION, idempotency_key: 'k',
    state: 'failed', external_record_id: null, canonical: null, claim_generation: 0, payload_digest: null,
  };
  const mirror: MirrorRow = { org_id: ORG, budget_version_id: VERSION, push_state: 'failed', erp_cancelled_at: null };
  const deps = budgetBackstopDepsLive(fakeDb(mirror, outbox), ORG_BINDING, []);
  await deps.driveBudgetPush(CANDIDATE, ACTIVE_VERSION).catch(() => undefined);
  assert(mirror.push_state === 'held', `expected 'held', got '${mirror.push_state}'`);
  assert(mirror.push_error === 'budget-push-attempts-exhausted', `expected the exhausted reason, got ${JSON.stringify(mirror.push_error)}`);
});
