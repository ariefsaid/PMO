// @e2e-isolation: serial — flips the shared org's external_domain_ownership + org bindings (org-global state).
/**
 * AC-XING-002 — the ERPNext crossing (#481, step 4 of #590): a stranded post-connect week is caught
 * up by the sweep, and a re-run of the sweep writes nothing more (A1b + A2, `OD-XING-1`).
 *
 * This is the `absent` arm `AC-TSP-022` already proves (an Approved week with no mirror row and no
 * outbox row is minted and pushed by the sweep alone, and a second tick mints nothing further) —
 * reused verbatim in kind, driven for THREE ticks so the multi-tick no-duplicate oracle is pinned at
 * the served boundary independently of that spec. The derived key `ts:<id>:<approved_at>` plus
 * `0134`'s `external_command_outbox_key_single_use` is what makes ticks 2 and 3 no-ops rather than a
 * second document.
 *
 * Run: scripts/with-db-lock.sh scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- \
 *        npx playwright test e2e/serial/AC-XING-002
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import {
  ORG_ID,
  cleanupTsp,
  listErpTimesheetsByAnchor,
  readApprovedAt,
  readTsMirror,
  runSweep,
  runWeek,
  seedTimesheet,
  seedTsp,
  timesheetPushKeyFor,
} from './_tspHelpers';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const READY = Boolean(FUNCTIONS_URL && AUTH_URL);
if (FUNCTIONS_URL && !READY) {
  throw new Error('AC-XING-002: SUPABASE_FUNCTIONS_URL + SUPABASE_URL are required once the served lane is up (SUPABASE_FUNCTIONS_URL set) — never a silent skip');
}
if (READY && !SERVICE_KEY) throw new Error('AC-XING-002: SUPABASE_SERVICE_ROLE_KEY is required whenever the served lane is available.');
test.skip(!READY, 'AC-XING-002: served-fn lane not configured — run via scripts/serve-functions.sh against the ERPNext bench');

test.setTimeout(240_000);

test('AC-XING-002 a stranded post-connect week is caught up by the sweep, and a third tick still writes nothing more', async () => {
  const admin = createClient(AUTH_URL, SERVICE_KEY);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const seeded = await seedTsp(admin, suffix);
  try {
    const runWeekAt = runWeek();
    const timesheetId = await seedTimesheet(admin, seeded, {
      status: 'Approved',
      weekStartDate: runWeekAt.weekStartDate,
      entries: [{ projectId: seeded.projectAId, entryDate: runWeekAt.day1, hours: '5.00' }],
    });
    const approvedAt = await readApprovedAt(admin, timesheetId);
    const week = { timesheetId, idempotencyKey: timesheetPushKeyFor(timesheetId, approvedAt) };

    // Precondition: nothing exists yet — the browser never got a request out.
    expect(await readTsMirror(admin, week.timesheetId), 'precondition: no mirror row').toBeNull();
    const { data: preOutbox } = await admin.from('external_command_outbox').select('id')
      .eq('org_id', ORG_ID).eq('domain', 'timesheets').eq('pmo_record_id', week.timesheetId);
    expect(preOutbox ?? [], 'precondition: no outbox row').toHaveLength(0);

    for (let tick = 1; tick <= 3; tick++) {
      expect((await runSweep(FUNCTIONS_URL)).status, `tick ${tick}`).toBe(200);
      const docs = await listErpTimesheetsByAnchor(week.idempotencyKey);
      expect(docs, `after tick ${tick} the week exists exactly once`).toHaveLength(1);
      expect(docs[0].docstatus, 'submitted, not left a draft').toBe(1);
    }
    const { data: rows } = await admin.from('external_command_outbox')
      .select('id, idempotency_key, state')
      .eq('org_id', ORG_ID).eq('domain', 'timesheets').eq('pmo_record_id', week.timesheetId);
    expect(rows ?? [], 'the derived key + 0134 single-use index admit exactly one command').toHaveLength(1);
    expect((rows ?? [])[0].idempotency_key).toBe(week.idempotencyKey);
    expect((rows ?? [])[0].state).toBe('confirmed');
  } finally {
    await cleanupTsp(admin, seeded);
  }
});
