/**
 * ⚑ Luna round-3 BLOCK 2 [Deno] — A NOT-DUE-YET COMMAND MUST NOT WEDGE THE TIMESHEET SLOT FOREVER.
 *
 * `outbox_reconcile_candidates` (0131) answers "may this row be reconciled NOW". A row it omits is
 * either finished with, genuinely out of budget (attempt-exhausted / too old) — or simply NOT DUE YET:
 * a `committing` row inside its 60 s lease, or a `quarantined` row before its visibility window
 * elapses. Both are ABOUT to become claimable by the stale-claim/recovery pass.
 *
 * The timesheet backstop treated every omission as exhaustion and parked the mirror `held`. That state
 * is excluded from this queue and the generic outbox pass skips timesheets, while the outbox row stays
 * inside 0116's one-in-flight-per-record index — so the ERP document is never adopted, the mirror never
 * converges, and the re-open fence (which refuses on a non-terminal outbox row) refuses the week
 * FOREVER. And this is the ORDINARY shape of a post-submit unknown: the dispatch deliberately marks
 * NOTHING so the row stays reclaimable, and the very next tick, seconds later, sees a `failed` mirror
 * plus a not-yet-due `committing` row.
 *
 * The fix is the budget twin's exception, already proven there (`⚑ HIGH-1`, index.ts's
 * `driveBudgetPush`): leave the mirror as it is and return; let the stale-claim/recovery pass own the
 * row. The attempt/age bound is untouched for every state that really has run out.
 *
 * These drive the SHIPPED `timesheetBackstopDepsLive` against a fake DB that really APPLIES update
 * predicates — the oracle is the mirror row's final state, not the shape of the query.
 *
 * Verify: deno test supabase/functions/erpnext-sweep/ --config supabase/functions/erpnext-sweep/deno.json
 */
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { timesheetBackstopDepsLive } = await import('./index.ts');
import type { SupabaseClient } from '@supabase/supabase-js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const ORG = '00000000-0000-4000-8000-0000000000aa';
const SHEET = '11111111-0000-0000-0000-000000000001';
const APPROVER = '22222222-0000-0000-0000-000000000002';
const APPROVED_AT = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

interface MirrorRow extends Record<string, unknown> {
  org_id: string;
  timesheet_id: string;
  push_state: string;
  erp_cancelled_at: string | null;
}

type Filter = { op: 'eq' | 'is'; col: string; val: unknown } | { op: 'in'; col: string; val: unknown[] };

function matches(row: MirrorRow, filters: Filter[]): boolean {
  return filters.every((f) => {
    if (f.op === 'in') return (f.val as unknown[]).includes(row[f.col]);
    return row[f.col] === f.val;
  });
}

/** A Supabase stand-in holding ONE real `timesheet_erp_mirror` row (updates honour their predicates)
 *  and ONE `external_command_outbox` row in the state under test. */
function fakeDb(mirror: MirrorRow, outboxState: string) {
  const client = {
    from(table: string) {
      const filters: Filter[] = [];
      let patch: Record<string, unknown> | null = null;
      const outbox = {
        id: 'outbox-1', domain: 'timesheets', pmo_record_id: SHEET, idempotency_key: `ts:${SHEET}:${APPROVED_AT}`,
        state: outboxState, external_record_id: null, canonical: null, claim_generation: 1, payload_digest: null,
      };
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
        maybeSingle: () => Promise.resolve({ data: table === 'external_command_outbox' ? outbox : null, error: null }),
        single: () => Promise.resolve({ data: null, error: null }),
        insert: () => Promise.resolve({ data: null, error: null }),
        update: (p: Record<string, unknown>) => { patch = p; return builder; },
        upsert: () => Promise.resolve({ data: null, error: null }),
        then: (resolve: (v: { data: unknown; error: null }) => unknown) => {
          if (patch && table === 'timesheet_erp_mirror' && matches(mirror, filters)) Object.assign(mirror, patch);
          return Promise.resolve({ data: [], error: null }).then(resolve);
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
  secretRef: 'not-due-bench',
  company: 'PMO Smoke Co',
  config: {},
  ownedDomains: ['timesheets'],
  versionMajor: 15,
};

const CANDIDATE = { timesheet_id: SHEET, push_state: 'failed', erp_cancelled_at: null };
const SUBJECT = { approvedBy: APPROVER, userId: APPROVER, entries: [] };

for (const state of ['committing', 'quarantined'] as const) {
  Deno.test(`⚑ Luna r3 BLOCK 2: an outbox row that is merely NOT DUE YET (${state}) is never parked held — a later tick owns it`, async () => {
    const mirror: MirrorRow = { org_id: ORG, timesheet_id: SHEET, push_state: 'failed', erp_cancelled_at: null };
    // The eligibility set is EMPTY — `outbox_reconcile_candidates` does not admit a fresh `committing`
    // row or a quarantined row before its window.
    const deps = timesheetBackstopDepsLive(fakeDb(mirror, state), ORG_BINDING, new Set());
    await deps.driveTimesheetPush(CANDIDATE, APPROVED_AT, SUBJECT).catch(() => undefined);
    assert(
      mirror.push_state === 'failed',
      `a not-yet-due command must be left for the stale-claim/recovery pass, got '${mirror.push_state}' — ` +
        "'held' is excluded from this queue and the outbox row keeps the record's one in-flight slot, so " +
        'the ERP Timesheet is never adopted and the week can never be re-opened',
    );
  });
}

Deno.test('⚑ Luna r3 BLOCK 2: a genuinely attempt-exhausted row (a `failed` command 0131 no longer admits) IS still held — the bound is not weakened', async () => {
  const mirror: MirrorRow = { org_id: ORG, timesheet_id: SHEET, push_state: 'failed', erp_cancelled_at: null };
  const deps = timesheetBackstopDepsLive(fakeDb(mirror, 'failed'), ORG_BINDING, new Set());
  await deps.driveTimesheetPush(CANDIDATE, APPROVED_AT, SUBJECT).catch(() => undefined);
  assert(mirror.push_state === 'held', `expected 'held', got '${mirror.push_state}'`);
  assert(
    mirror.push_error === 'timesheet-push-attempts-exhausted',
    `expected the exhausted reason, got ${JSON.stringify(mirror.push_error)}`,
  );
});

// ⚑ Luna FU-1a round-8 BLOCK — the sweep's HELD park is the second producer of "PMO does not know what
// ERPNext holds", and it must record that as durably as the dispatch's own recorder does. A command
// whose attempts ran out may have run them out AFTER a submit landed (a post-submit unknown is retried
// as `external-unreachable`), so parking `held` without the witness leaves the fence resting on
// push_state alone — and push_state is exactly what an operator's hold release clears.
Deno.test('round-8: the attempts-exhausted HELD park also stamps the unknown-ERP-outcome witness', async () => {
  const mirror: MirrorRow = { org_id: ORG, timesheet_id: SHEET, push_state: 'failed', erp_cancelled_at: null };
  const deps = timesheetBackstopDepsLive(fakeDb(mirror, 'failed'), ORG_BINDING, new Set());
  await deps.driveTimesheetPush(CANDIDATE, APPROVED_AT, SUBJECT).catch(() => undefined);
  assert(
    typeof mirror.post_submit_unknown_at === 'string' && mirror.post_submit_unknown_at.length > 0,
    `the held park must record that the ERP outcome is unknown, got ${JSON.stringify(mirror.post_submit_unknown_at)}`,
  );
});

// The mirror image: a `failed` park is NOT an unknown. `timesheet-push-no-outbox-candidate` /
// gate refusals mean nothing was ever sent, so stamping a witness there would fence a week that has no
// ERP question outstanding — an unknown that is set on ordinary refusals teaches operators to attest
// reflexively, which is how an attestation stops being evidence.
Deno.test('round-8: a `failed` park (a gate refusal — nothing was ever sent) does NOT stamp the witness', async () => {
  const mirror: MirrorRow = { org_id: ORG, timesheet_id: SHEET, push_state: 'failed', erp_cancelled_at: null };
  const deps = timesheetBackstopDepsLive(fakeDb(mirror, 'failed'), ORG_BINDING, new Set());
  await deps.recordGateRefusal(CANDIDATE, 'timesheet-push-gate-refused').catch(() => undefined);
  assert(mirror.push_error === 'timesheet-push-gate-refused', `expected the refusal reason, got ${JSON.stringify(mirror.push_error)}`);
  assert(
    mirror.post_submit_unknown_at === undefined,
    `a refusal park must not claim an unknown ERP outcome, got ${JSON.stringify(mirror.post_submit_unknown_at)}`,
  );
});
