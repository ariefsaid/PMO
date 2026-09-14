// @e2e-isolation: serial — flips the shared org's external_domain_ownership + org bindings (org-global state).
/**
 * AC-XING-001 — the ERPNext crossing (#481, step 4 of #590): a week approved BEFORE the binding
 * activated is never pushed, while a week approved after it is (`OD-XING-1`).
 *
 * `OD-XING-1` fixed the default: the ERP starts at connect; nothing authored before the binding is
 * pushed. The tree already refuses pre-binding hours by design
 * (`listApprovedSheetsWithoutMirror`'s `floor = max(lookback, activated_at)`,
 * `erpnext-sweep/index.ts:1503-1527`) — this spec observes that refusal against a real binding row
 * rather than asserting a mechanism that does not exist.
 *
 * The oracle is DIFFERENTIAL — two sheets, one tick — so that "the sweep did nothing at all" cannot
 * pass: a week approved 12h before a back-dated `activated_at` must never reach ERP, while a week
 * approved after `activated_at` must land. The 14-day lookback floor (`ABSENT_SHEET_LOOKBACK_MS`) is
 * far wider than the one-day back-date used here, so `activated_at` — not the lookback — is the only
 * thing that can exclude the pre-binding sheet.
 *
 * Run: scripts/with-db-lock.sh scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- \
 *        npx playwright test e2e/serial/AC-XING-001
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
  throw new Error('AC-XING-001: SUPABASE_FUNCTIONS_URL + SUPABASE_URL are required once the served lane is up (SUPABASE_FUNCTIONS_URL set) — never a silent skip');
}
if (READY && !SERVICE_KEY) throw new Error('AC-XING-001: SUPABASE_SERVICE_ROLE_KEY is required whenever the served lane is available.');
test.skip(!READY, 'AC-XING-001: served-fn lane not configured — run via scripts/serve-functions.sh against the ERPNext bench');

test.setTimeout(240_000);

test('AC-XING-001 a week approved BEFORE the binding activated is never pushed, while a week approved after it is', async () => {
  const admin = createClient(AUTH_URL, SERVICE_KEY);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const seeded = await seedTsp(admin, suffix);
  try {
    // Back-date activation by one day. The 14-day lookback floor (ABSENT_SHEET_LOOKBACK_MS) is far
    // wider than that, so `activated_at` — not the lookback — is the only thing that can exclude the
    // pre-binding sheet. That is what makes this a test of the crossing rule and not of the lookback.
    const activatedAt = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { error: bindErr } = await admin.from('external_org_bindings')
      .update({ activated_at: activatedAt })
      .eq('org_id', ORG_ID).eq('external_tier', 'erpnext');
    expect(bindErr).toBeNull();

    const before = runWeek();
    const preId = await seedTimesheet(admin, seeded, {
      status: 'Approved',
      weekStartDate: before.weekStartDate,
      entries: [{ projectId: seeded.projectAId, entryDate: before.day1, hours: '4.00' }],
      approvedAt: new Date(Date.parse(activatedAt) - 12 * 3600_000).toISOString(),
    });
    const after = runWeek();
    const postId = await seedTimesheet(admin, seeded, {
      status: 'Approved',
      weekStartDate: after.weekStartDate,
      entries: [{ projectId: seeded.projectAId, entryDate: after.day1, hours: '4.00' }],
    });
    const preKey = timesheetPushKeyFor(preId, await readApprovedAt(admin, preId));
    const postKey = timesheetPushKeyFor(postId, await readApprovedAt(admin, postId));

    expect((await runSweep(FUNCTIONS_URL)).status).toBe(200);

    // The post-connect week lands — this is what makes the pre-connect silence meaningful.
    expect(await listErpTimesheetsByAnchor(postKey), 'a week approved after connect must reach ERP').toHaveLength(1);
    expect((await readTsMirror(admin, postId))?.push_state).toBe('pushed');

    // The pre-connect week is refused: no ERP document, no mirror row, no outbox row.
    expect(await listErpTimesheetsByAnchor(preKey), 'nothing authored before the binding may reach ERP').toHaveLength(0);
    expect(await readTsMirror(admin, preId), 'and no mirror row is minted for it').toBeNull();
    const { data: preOutbox } = await admin.from('external_command_outbox').select('id, state')
      .eq('org_id', ORG_ID).eq('domain', 'timesheets').eq('pmo_record_id', preId);
    expect(preOutbox ?? [], 'and no outbox row that could later succeed').toHaveLength(0);
  } finally {
    await cleanupTsp(admin, seeded);
  }
});
