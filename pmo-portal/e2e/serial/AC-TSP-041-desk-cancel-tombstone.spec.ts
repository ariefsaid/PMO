// @e2e-isolation: serial — flips the shared org's external_domain_ownership + org bindings (org-global state).
/**
 * AC-TSP-041 — a Desk cancel TOMBSTONES and REOPENS, and the sweep does not fight the accountant
 * (FR-TSP-084, ADR-0059 §5 corollary).
 *
 * Given a pushed Timesheet that an accountant cancels in the ERPNext Desk,
 * When the feed applies the cancel and the sweep then ticks TWICE,
 * Then the mirror is soft-tombstoned (`erp_cancelled_at`, `erp_docstatus=2`), a lineage row
 * (`reason='cancelled'`) is written, `external_refs` is RETAINED, `push_state='failed'` with an
 * `action-required` surface, the PMO `timesheets` row is STILL `Approved` and otherwise untouched, and
 * the sweep issues NO re-push on either tick.
 *
 * ⚑ Both halves matter. Re-pushing would restart an infinite fight with the human who just cancelled;
 * and silently accepting the cancel would let ERP revoke a PMO approval it does not own. PMO's decision
 * stands; ERP's state is reported.
 *
 * Run: scripts/with-db-lock.sh scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- \
 *        npx playwright test e2e/serial/AC-TSP-041
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'node:crypto';
import {
  ORG_ID,
  ADMIN_EMAIL,
  WEBHOOK_SECRET,
  actionRequiredNotifications,
  benchGet,
  benchPut,
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
  throw new Error('AC-TSP-041: SUPABASE_FUNCTIONS_URL + SUPABASE_URL + VITE_SUPABASE_ANON_KEY are required in CI — this spec cannot silently skip');
}
if (READY && !SERVICE_KEY) throw new Error('AC-TSP-041: SUPABASE_SERVICE_ROLE_KEY is required whenever the served lane is available.');
test.skip(!READY, 'AC-TSP-041: served-fn lane not configured — run via scripts/serve-functions.sh against the ERPNext bench');

test.setTimeout(240_000);

const signErpWebhook = (rawBody: string): string => createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('base64');

test.describe('AC-TSP-041: an accountant cancels the pushed Timesheet in the Desk', () => {
  test('AC-TSP-041 the cancel tombstones + reopens the push, PMO stays Approved, and two sweep ticks issue NO re-push', async () => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seeded = await seedTsp(admin, suffix);

    try {
      // ── A genuinely pushed week. ──
      const week = runWeek();
      const timesheetId = await seedTimesheet(admin, seeded, {
        status: 'Approved',
        weekStartDate: week.weekStartDate,
        entries: [{ projectId: seeded.projectAId, entryDate: week.day1, hours: '7.00' }],
      });
      const approvedAt = await readApprovedAt(admin, timesheetId);
      const idempotencyKey = timesheetPushKeyFor(timesheetId, approvedAt);
      const token = await signInAs(AUTH_URL, ANON_KEY, ADMIN_EMAIL);
      const pushed = await dispatchTimesheetPush(FUNCTIONS_URL, ANON_KEY, token, { id: timesheetId }, idempotencyKey);
      expect(pushed.status, `the push must land first: ${await pushed.text()}`).toBe(200);
      const beforeMirror = await readTsMirror(admin, timesheetId);
      expect(beforeMirror?.push_state).toBe('pushed');
      const tsName = beforeMirror!.ts_number!;

      const { data: sheetBefore } = await admin
        .from('timesheets').select('status, approved_by, approved_at').eq('id', timesheetId).maybeSingle();

      // ── The accountant cancels it in the Desk. ──
      await benchPut('Timesheet', tsName, { docstatus: 2 });
      const cancelled = (await benchGet(`/api/resource/Timesheet/${encodeURIComponent(tsName)}`)) as { docstatus: number; modified: string };
      expect(cancelled.docstatus, 'the ERP document really is cancelled').toBe(2);

      // ── The feed applies the cancel (webhook hint), then the sweep ticks TWICE. ──
      const rawBody = JSON.stringify({
        doctype: 'Timesheet',
        name: tsName,
        docstatus: 2,
        modified: cancelled.modified,
        data: { doctype: 'Timesheet', name: tsName, docstatus: 2, modified: cancelled.modified, company: 'PMO Smoke Co', amended_from: null },
      });
      const webhookRes = await fetch(`${FUNCTIONS_URL}/functions/v1/erpnext-webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Frappe-Webhook-Signature': signErpWebhook(rawBody) },
        body: rawBody,
      });
      expect(webhookRes.status, `the cancel event is applied (got ${webhookRes.status}: ${await webhookRes.text()})`).toBe(200);

      expect((await runSweep(FUNCTIONS_URL)).status, 'sweep tick 1').toBe(200);
      expect((await runSweep(FUNCTIONS_URL)).status, 'sweep tick 2').toBe(200);

      // ── The mirror is a TOMBSTONE, and the push is reopened for a human. ──
      const mirror = await readTsMirror(admin, timesheetId);
      expect(mirror?.erp_cancelled_at, 'the mirror is soft-tombstoned').not.toBeNull();
      expect(mirror?.erp_docstatus, "ERP's own cancelled docstatus is mirrored").toBe(2);
      expect(mirror?.push_state, 'the push is reopened as failed so an operator sees it').toBe('failed');

      // Lineage records the supersession (never a silent state change).
      const { data: lineage } = await admin
        .from('external_ref_lineage')
        .select('reason, superseded_external_record_id, erp_docstatus')
        .eq('org_id', ORG_ID)
        .eq('domain', 'timesheets')
        .eq('pmo_record_id', timesheetId);
      expect((lineage ?? []).map((l) => (l as { reason: string }).reason), 'a cancel lineage row is written').toContain('cancelled');

      // external_refs is RETAINED — the mapping is history, not garbage (only an amend repoints it).
      const { data: refRow } = await admin
        .from('external_refs').select('external_record_id')
        .eq('org_id', ORG_ID).eq('domain', 'timesheets').eq('pmo_record_id', timesheetId).maybeSingle();
      expect((refRow as { external_record_id: string } | null)?.external_record_id, 'external_refs still points at the cancelled document').toBe(tsName);

      // The operator is told a human cancelled it.
      const surfaced = await actionRequiredNotifications(admin, 'timesheet-desk-cancelled', { pmoRecordId: timesheetId });
      expect(surfaced.length, 'an action-required names the desk cancel').toBeGreaterThan(0);

      // ⚑ PMO's own decision is NOT ERP's to revoke.
      const { data: sheetAfter } = await admin
        .from('timesheets').select('status, approved_by, approved_at').eq('id', timesheetId).maybeSingle();
      expect((sheetAfter as { status: string }).status, 'the PMO week is still Approved').toBe('Approved');
      expect(sheetAfter, 'the PMO row is otherwise byte-identical').toEqual(sheetBefore);

      // ⚑ AND the sweep never fought the accountant: still ONE document, still cancelled.
      const docs = await listErpTimesheetsByAnchor(idempotencyKey);
      expect(docs, 'no replacement Timesheet was created by either tick').toHaveLength(1);
      expect(docs[0].name).toBe(tsName);
      expect(docs[0].docstatus, 'the cancelled document was left cancelled').toBe(2);
    } finally {
      await admin.from('notifications').delete().eq('org_id', ORG_ID).contains('metadata', { action_required: 'timesheet-desk-cancelled' });
      await cleanupTsp(admin, seeded);
    }
  });
});
