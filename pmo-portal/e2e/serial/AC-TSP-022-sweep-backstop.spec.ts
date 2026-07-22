// @e2e-isolation: serial — flips the shared org's external_domain_ownership + org bindings (org-global state).
/**
 * AC-TSP-022 — the sweep backstop: it RE-DRIVES an approved-but-unpushed sheet and NEVER re-drives a
 * settled one (FR-TSP-045, FR-TSP-010, ADR-0059 §3.3).
 *
 * Until the backstop existed the timesheet push had exactly ONE originator: the browser that approved
 * the week. A push that died after the approval committed (tab closed, dropped connection, platform 502)
 * was stranded with nothing to recover it — PMO said Approved, the client's ERP never heard about the
 * hours, and nobody was told. This spec drives the REAL `erpnext-sweep` and holds it to the AC's whole
 * matrix, one arm per test so the result is a matrix and not a single yes/no.
 *
 * Given approved sheets in `push_state` ∈ {absent, `pending`, `failed`, `pushed`, `held`} and ERP reachable,
 * When the sweep ticks,
 * Then absent/`pending`/`failed` are pushed and become `pushed`; `pushed`/`held` are NOT touched (no ERP
 * call); and the sweep RE-ASSERTS the Approved gate rather than trusting the mirror row.
 *
 * Run: scripts/with-db-lock.sh scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- \
 *        npx playwright test e2e/serial/AC-TSP-022
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  ORG_ID,
  ADMIN_EMAIL,
  actionRequiredNotifications,
  cleanupTsp,
  dispatchTimesheetPush,
  listErpTimesheetsByAnchor,
  readApprovedAt,
  readTsMirror,
  runSweep,
  runWeek,
  seedTimesheet,
  seedTsp,
  signInAs,
  timesheetPushKeyFor,
  type TspSeed,
} from './_tspHelpers';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const READY = Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY);
if (!READY && process.env.CI) {
  throw new Error('AC-TSP-022: SUPABASE_FUNCTIONS_URL + SUPABASE_URL + VITE_SUPABASE_ANON_KEY are required in CI — this spec cannot silently skip');
}
if (READY && !SERVICE_KEY) throw new Error('AC-TSP-022: SUPABASE_SERVICE_ROLE_KEY is required whenever the served lane is available.');
test.skip(!READY, 'AC-TSP-022: served-fn lane not configured — run via scripts/serve-functions.sh (ERPNEXT_TEST_FAULTS=1) against the ERPNext bench');

test.setTimeout(240_000);

/** An Approved week with real hours on the run's own project. */
async function approvedWeek(admin: SupabaseClient, seeded: TspSeed) {
  const week = runWeek();
  const timesheetId = await seedTimesheet(admin, seeded, {
    status: 'Approved',
    weekStartDate: week.weekStartDate,
    entries: [{ projectId: seeded.projectAId, entryDate: week.day1, hours: '5.00' }],
  });
  const approvedAt = await readApprovedAt(admin, timesheetId);
  return { timesheetId, approvedAt, idempotencyKey: timesheetPushKeyFor(timesheetId, approvedAt) };
}

test.describe('AC-TSP-022: the sweep backstop — the push\'s second originator', () => {
  test('AC-TSP-022 the backstop RECOVERS a stranded push: the browser died after the ERP commit, and the sweep alone finalizes it', async () => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seeded = await seedTsp(admin, suffix);
    try {
      const week = await approvedWeek(admin, seeded);
      const token = await signInAs(AUTH_URL, ANON_KEY, ADMIN_EMAIL);

      // The browser dies AFTER the ERP commit and BEFORE the mirror write (the R3 window).
      const faulted = await dispatchTimesheetPush(
        FUNCTIONS_URL, ANON_KEY, token, { id: week.timesheetId }, week.idempotencyKey, 'after-commit-before-mirror',
      );
      expect(faulted.status, 'the push is interrupted server-side').toBe(500);
      expect(await listErpTimesheetsByAnchor(week.idempotencyKey), 'the ERP document already exists').toHaveLength(1);

      // ── The user never comes back. ONLY the sweep runs. ──
      const sweep = await runSweep(FUNCTIONS_URL);
      expect(sweep.status, `sweep tick failed: ${JSON.stringify(sweep.body)}`).toBe(200);

      const mirror = await readTsMirror(admin, week.timesheetId);
      expect(mirror?.push_state, `the backstop must settle the stranded push, got ${JSON.stringify(mirror)}`).toBe('pushed');
      expect(mirror?.ts_number, 'the mirror names the real ERP document').toMatch(/^TS-/);

      // …and it recovered the SAME document rather than minting a second week of hours.
      const docs = await listErpTimesheetsByAnchor(week.idempotencyKey);
      expect(docs, 'the backstop recovers, it never duplicates').toHaveLength(1);
      expect(docs[0].name).toBe(mirror?.ts_number);

      const { data: refRow } = await admin.from('external_refs').select('external_record_id')
        .eq('org_id', ORG_ID).eq('domain', 'timesheets').eq('pmo_record_id', week.timesheetId).maybeSingle();
      expect((refRow as { external_record_id: string } | null)?.external_record_id, 'the mapping the crash lost is now recorded').toBe(mirror?.ts_number);
    } finally {
      await cleanupTsp(admin, seeded);
    }
  });

  test('AC-TSP-022 the backstop drives an approved week whose push NEVER REACHED ERP (mirror `pending`) and settles it as pushed', async () => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seeded = await seedTsp(admin, suffix);
    try {
      const week = await approvedWeek(admin, seeded);
      // The AC's `pending` arm: the sheet is Approved and the mirror says the push has not settled.
      const { error } = await admin.from('timesheet_erp_mirror').insert({
        org_id: ORG_ID, timesheet_id: week.timesheetId, push_state: 'pending', approved_at_pushed: week.approvedAt,
      });
      expect(error).toBeNull();

      const sweep = await runSweep(FUNCTIONS_URL);
      expect(sweep.status).toBe(200);

      const mirror = await readTsMirror(admin, week.timesheetId);
      expect(mirror?.push_state, `an approved-but-unpushed week must reach ERP, got ${JSON.stringify(mirror)}`).toBe('pushed');
      const docs = await listErpTimesheetsByAnchor(week.idempotencyKey);
      expect(docs, 'the approved week is on the client ledger exactly once').toHaveLength(1);
      expect(docs[0].docstatus).toBe(1);
    } finally {
      await cleanupTsp(admin, seeded);
    }
  });

  // ⚑ MEDIUM-1 (money-safety audit round 5) — THE `absent` ARM. The matrix in this file's header claimed
  // it, but every other test here operates on a sheet that HAS a mirror row, so the headline case of the
  // whole backstop — "the browser died BEFORE the fetch reached the server", which leaves NO mirror row
  // and NO outbox row — was the only one never proven end to end, and it is the only one in which
  // `mintTimesheetOutboxRow` executes against a real bench at all. It is also the only arm that
  // exercises the `absent` queue's SQL (⚑ HIGH-3's embedded-resource anti-join), which no fake can prove.
  test('AC-TSP-022 the `absent` arm: an Approved week with NO mirror row and NO outbox row is MINTED and pushed by the sweep alone', async () => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seeded = await seedTsp(admin, suffix);
    try {
      const week = await approvedWeek(admin, seeded);

      // Nothing at all exists for this week besides the approval itself — the browser never got a
      // request out. Assert that precondition rather than assuming it.
      expect(await readTsMirror(admin, week.timesheetId), 'precondition: no mirror row').toBeNull();
      const { data: preOutbox } = await admin.from('external_command_outbox').select('id')
        .eq('org_id', ORG_ID).eq('domain', 'timesheets').eq('pmo_record_id', week.timesheetId);
      expect(preOutbox ?? [], 'precondition: no outbox row').toHaveLength(0);

      // ── ONLY the sweep runs. No user, no retry, no UI. ──
      const sweep = await runSweep(FUNCTIONS_URL);
      expect(sweep.status, `sweep tick failed: ${JSON.stringify(sweep.body)}`).toBe(200);

      const docs = await listErpTimesheetsByAnchor(week.idempotencyKey);
      expect(
        docs,
        `the stranded week must reach the client's ERP — mirror: ${JSON.stringify(await readTsMirror(admin, week.timesheetId))}`,
      ).toHaveLength(1);
      expect(docs[0].docstatus, 'submitted — approved hours are committed to costing, not left a draft').toBe(1);

      const mirror = await readTsMirror(admin, week.timesheetId);
      expect(mirror?.push_state, `the mirror must settle: ${JSON.stringify(mirror)}`).toBe('pushed');
      expect(mirror?.ts_number, 'the mirror names the real ERP document').toBe(docs[0].name);

      const { data: refRow } = await admin.from('external_refs').select('external_record_id')
        .eq('org_id', ORG_ID).eq('domain', 'timesheets').eq('pmo_record_id', week.timesheetId).maybeSingle();
      expect(
        (refRow as { external_record_id: string } | null)?.external_record_id,
        'the mapping is recorded, so the sheet is resolvable from PMO afterwards',
      ).toBe(docs[0].name);

      // The minted command is ATTRIBUTED to the sheet's own approver and carries the deterministic key
      // both originators derive — that is what makes the foreground and the sweep reconcile as ONE
      // command instead of rejecting each other on a payload-digest mismatch.
      const { data: outboxRow } = await admin.from('external_command_outbox')
        .select('idempotency_key, actor_user_id, state')
        .eq('org_id', ORG_ID).eq('domain', 'timesheets').eq('pmo_record_id', week.timesheetId).maybeSingle();
      const minted = outboxRow as { idempotency_key: string; actor_user_id: string | null; state: string } | null;
      expect(minted?.idempotency_key, 'the SAME key the UI would have derived').toBe(week.idempotencyKey);
      expect(minted?.actor_user_id, 'the minted command is attributable, never anonymous').toBeTruthy();
      expect(minted?.state).toBe('confirmed');

      // ── A SECOND tick must not mint a second week of hours. ──
      expect((await runSweep(FUNCTIONS_URL)).status).toBe(200);
      expect(await listErpTimesheetsByAnchor(week.idempotencyKey), 'the backstop recovers, it never duplicates').toHaveLength(1);
      expect((await readTsMirror(admin, week.timesheetId))?.push_state, 'and the settled week stays settled').toBe('pushed');
    } finally {
      await cleanupTsp(admin, seeded);
    }
  });

  test('AC-TSP-022 the backstop NEVER re-drives a settled (`pushed`) or terminal (`held`) sheet — zero ERP writes across two ticks', async () => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seeded = await seedTsp(admin, suffix);
    try {
      // (a) a genuinely pushed week
      const pushedWeek = await approvedWeek(admin, seeded);
      const token = await signInAs(AUTH_URL, ANON_KEY, ADMIN_EMAIL);
      const ok = await dispatchTimesheetPush(FUNCTIONS_URL, ANON_KEY, token, { id: pushedWeek.timesheetId }, pushedWeek.idempotencyKey);
      expect(ok.status, `the first push must land: ${await ok.text()}`).toBe(200);
      const settled = await readTsMirror(admin, pushedWeek.timesheetId);
      expect(settled?.push_state).toBe('pushed');

      // (b) a HELD week — ADR-0058-terminal until an operator acts
      const heldWeek = await approvedWeek(admin, seeded);
      await admin.from('timesheet_erp_mirror').insert({
        org_id: ORG_ID, timesheet_id: heldWeek.timesheetId, push_state: 'held',
        push_error: 'command-held', approved_at_pushed: heldWeek.approvedAt,
      });

      // Two ticks — a backstop that re-drives would show it on the second at the latest.
      expect((await runSweep(FUNCTIONS_URL)).status).toBe(200);
      expect((await runSweep(FUNCTIONS_URL)).status).toBe(200);

      const afterPushed = await readTsMirror(admin, pushedWeek.timesheetId);
      expect(afterPushed?.push_state, 'a settled week stays settled').toBe('pushed');
      expect(afterPushed?.ts_number, 'and still names the SAME ERP document').toBe(settled?.ts_number);
      expect(await listErpTimesheetsByAnchor(pushedWeek.idempotencyKey), 'no second document for the settled week').toHaveLength(1);

      const afterHeld = await readTsMirror(admin, heldWeek.timesheetId);
      expect(afterHeld?.push_state, '`held` is terminal until a human acts — the sweep must not move it').toBe('held');
      expect(await listErpTimesheetsByAnchor(heldWeek.idempotencyKey), 'a held week never reaches ERP by itself').toHaveLength(0);
    } finally {
      await cleanupTsp(admin, seeded);
    }
  });

  test('AC-TSP-022 the backstop RE-ASSERTS the Approved gate rather than trusting the mirror row: a sheet reopened behind its back is never pushed', async () => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seeded = await seedTsp(admin, suffix);
    try {
      const week = await approvedWeek(admin, seeded);
      const token = await signInAs(AUTH_URL, ANON_KEY, ADMIN_EMAIL);

      // A failed push that never reached ERP (the ERP was unreachable) — a legitimate backstop candidate.
      const failed = await dispatchTimesheetPush(
        FUNCTIONS_URL, ANON_KEY, token, { id: week.timesheetId }, week.idempotencyKey, 'unreachable',
      );
      expect([500, 502, 503].includes(failed.status), `expected an unreachable failure, got ${failed.status}: ${await failed.text()}`).toBe(true);
      expect(await listErpTimesheetsByAnchor(week.idempotencyKey), 'nothing reached ERP').toHaveLength(0);
      const beforeMirror = await readTsMirror(admin, week.timesheetId);
      expect(beforeMirror?.push_state, 'the failure is durable + operator-visible').toBe('failed');

      // ⚑ Behind the sweep's back, the week stops being Approved (a manager reopens it for correction).
      const { error: reopenErr } = await admin.from('timesheets')
        .update({ status: 'Submitted', approved_by: null, approved_at: null }).eq('id', week.timesheetId);
      expect(reopenErr).toBeNull();

      const sweep = await runSweep(FUNCTIONS_URL);
      expect(sweep.status).toBe(200);

      // The oracle: hours that are no longer approved never reach the client's ledger.
      expect(await listErpTimesheetsByAnchor(week.idempotencyKey), 'the sweep re-read DB truth and refused').toHaveLength(0);
      const after = await readTsMirror(admin, week.timesheetId);
      expect(['failed', 'held'], `a refused candidate must stay refused, got ${JSON.stringify(after)}`).toContain(after?.push_state);
      // …and the refusal is SURFACED, never a silent drop (FR-TSP-085).
      const surfaced = await actionRequiredNotifications(admin, 'timesheet-push-gate-refused', { timesheetId: week.timesheetId });
      expect(surfaced.length, 'the operator is told WHY the sheet stopped pushing').toBeGreaterThan(0);
    } finally {
      await cleanupTsp(admin, seeded);
    }
  });
});
