// @e2e-isolation: serial — flips the shared org's external_domain_ownership + org bindings (org-global state).
/**
 * AC-TSP-020 — ⚑ THE SWEEP AND THE USER CANNOT BOTH CREATE A TIMESHEET (FR-TSP-040/041/044/045,
 * NFR-TSP-IDEM-001, ADR-0058 §4, ADR-0059 §4).
 *
 * The push has TWO independent originators with no shared client state: the Approvals UI and the
 * `erpnext-sweep` backstop. If they ever both commit, the client is not billed a duplicate ROW — they
 * are billed a DUPLICATED WEEK OF HOURS on a real project's cost. This spec drives BOTH, for real.
 *
 * Given an Approved sheet whose first push is interrupted by the shipped `after-commit-before-mirror`
 * fault seam (the ERP write lands; the process dies before the PMO mirror does),
 * When the REAL sweep tick and a user-triggered re-push both run,
 * Then the deterministic key `ts:<id>:<approved_at>` makes the second attempt collide and reconcile
 * rather than write, and — the oracle — ERPNext holds EXACTLY ONE Timesheet stamped with that key
 * (`note`, the doctype's recovery anchor), with the mirror reporting `pushed` + the winner's name.
 *
 * ⚑ The ERP is the oracle, not PMO state: a duplicate would be invisible in `timesheet_erp_mirror`
 * (one row per sheet by construction) and perfectly visible on the client's ledger.
 *
 * Run: scripts/with-db-lock.sh scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- \
 *        npx playwright test e2e/serial/AC-TSP-020
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import {
  ORG_ID,
  ADMIN_EMAIL,
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
} from './_tspHelpers';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const READY = Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY);
if (!READY && process.env.CI) {
  throw new Error('AC-TSP-020: SUPABASE_FUNCTIONS_URL + SUPABASE_URL + VITE_SUPABASE_ANON_KEY are required in CI — this spec cannot silently skip');
}
if (READY && !SERVICE_KEY) throw new Error('AC-TSP-020: SUPABASE_SERVICE_ROLE_KEY is required whenever the served lane is available.');
test.skip(!READY, 'AC-TSP-020: served-fn lane not configured — run via scripts/serve-functions.sh (ERPNEXT_TEST_FAULTS=1) against the ERPNext bench');

test.setTimeout(240_000);

test.describe('AC-TSP-020: two originators, one week of hours', () => {
  test('AC-TSP-020 after an after-commit-before-mirror interruption, the sweep tick AND a user re-push both run — ERPNext still holds EXACTLY ONE Timesheet for the week', async () => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seeded = await seedTsp(admin, suffix);

    try {
      const week = runWeek();
      const timesheetId = await seedTimesheet(admin, seeded, {
        status: 'Approved',
        weekStartDate: week.weekStartDate,
        entries: [
          { projectId: seeded.projectAId, entryDate: week.day1, hours: '6.00' },
          { projectId: seeded.projectBId, entryDate: week.day2, hours: '2.50' },
        ],
      });
      // The key BOTH originators derive — from the server's own witness, never a client clock.
      const approvedAt = await readApprovedAt(admin, timesheetId);
      const idempotencyKey = timesheetPushKeyFor(timesheetId, approvedAt);

      const accessToken = await signInAs(AUTH_URL, ANON_KEY, ADMIN_EMAIL);
      const record = { id: timesheetId };

      // ── The interrupted push: the ERP write COMMITS, then the process dies before the mirror. ──
      const faulted = await dispatchTimesheetPush(FUNCTIONS_URL, ANON_KEY, accessToken, record, idempotencyKey, 'after-commit-before-mirror');
      const faultedBody = await faulted.text();
      expect(faulted.status, `the armed fault must interrupt the push after the ERP commit (body: ${faultedBody})`).toBe(500);

      const { data: outboxAfterFault } = await admin
        .from('external_command_outbox')
        .select('state, external_record_id')
        .eq('org_id', ORG_ID)
        .eq('domain', 'timesheets')
        .eq('pmo_record_id', timesheetId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      expect((outboxAfterFault as { state: string } | null)?.state, 'the ERP write is canonical-persisted (ADR-0058 F2) before the crash').toBe('committed');
      const committedName = (outboxAfterFault as { external_record_id: string }).external_record_id;
      expect(committedName).toMatch(/^TS-/);

      // ERP already holds exactly one document for this key — the crash was AFTER the write.
      expect(await listErpTimesheetsByAnchor(idempotencyKey)).toHaveLength(1);

      // ── BOTH originators now converge on the same stranded command, concurrently. ──
      const userToken = await signInAs(AUTH_URL, ANON_KEY, ADMIN_EMAIL);
      const [sweep, rePush] = await Promise.all([
        runSweep(FUNCTIONS_URL),
        dispatchTimesheetPush(FUNCTIONS_URL, ANON_KEY, userToken, record, idempotencyKey),
      ]);
      expect(sweep.status, `the sweep tick must run: ${JSON.stringify(sweep.body)}`).toBe(200);
      const rePushBody = await rePush.text();
      // The user's retry either finalizes (200) or loses the race to the sweep and is told the command
      // is settling (409) — what it must NEVER do is write a second document.
      expect(
        [200, 409].includes(rePush.status),
        `the retry must reconcile or defer, never error into a second write (got ${rePush.status}: ${rePushBody})`,
      ).toBe(true);

      // Give the losing originator a moment to observe the winner's outcome.
      await new Promise((r) => setTimeout(r, 2_000));

      // ⚑ THE GOAL ORACLE — the client's ledger. One approval, one week, ONE ERP Timesheet.
      const erpDocs = await listErpTimesheetsByAnchor(idempotencyKey);
      expect(erpDocs.map((d) => d.name), 'exactly ONE ERP Timesheet carries this approval key').toHaveLength(1);
      expect(erpDocs[0].name).toBe(committedName);
      expect(erpDocs[0].docstatus, 'the surviving document is SUBMITTED').toBe(1);

      // And PMO converged on the winner rather than on a fiction.
      const mirror = await readTsMirror(admin, timesheetId);
      expect(mirror?.push_state, `mirror did not converge: ${JSON.stringify(mirror)}`).toBe('pushed');
      expect(mirror?.ts_number, "the mirror names the winner's ERP document").toBe(committedName);

      const { data: outboxRows } = await admin
        .from('external_command_outbox')
        .select('state, idempotency_key')
        .eq('org_id', ORG_ID)
        .eq('domain', 'timesheets')
        .eq('pmo_record_id', timesheetId);
      expect(outboxRows ?? [], 'the deterministic key means ONE outbox row, not one per originator').toHaveLength(1);
      expect((outboxRows as Array<{ state: string }>)[0].state).toBe('confirmed');
    } finally {
      await cleanupTsp(admin, seeded);
    }
  });
});
