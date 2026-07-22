// @e2e-isolation: serial — flips the shared org's external_domain_ownership + org bindings (org-global state).
/**
 * AC-TSP-040 — ⚑ a NATIVELY-created ERP Timesheet is NEVER adopted (FR-TSP-082, ADR-0059 §5).
 *
 * PMO owns timesheet ENTRY AND APPROVAL (Posture B). Adopting a Timesheet somebody typed into the
 * ERPNext Desk would import a week of hours that no PMO approver ever approved — and it would then
 * appear in PMO's own reporting as if it had been. So the rule is the exact INVERSE of P3a's revenue
 * adopt: ack the event, surface it for a human, and mint NOTHING.
 *
 * Given a `Timesheet` created directly on the bench (no PMO command, no `external_refs` mapping) and an
 * inbound webhook + a sweep tick,
 * When the feed processes it,
 * Then NO `timesheets` row, NO `timesheet_entries` rows and NO `timesheet_erp_mirror` row are minted;
 * the webhook ACKS (it is a lossy hint, not an error); an `action-required` names the ERP document; and
 * PMO's timesheet counts are unchanged.
 *
 * Run: scripts/with-db-lock.sh scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- \
 *        npx playwright test e2e/serial/AC-TSP-040
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHmac } from 'node:crypto';
import {
  ORG_ID,
  ERP_ACTIVITY_TYPE,
  ERP_COMPANY,
  ERP_EMPLOYEE,
  WEBHOOK_SECRET,
  actionRequiredNotifications,
  benchPost,
  benchPut,
  cleanupTsp,
  runSweep,
  runWeek,
  seedTsp,
} from './_tspHelpers';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const READY = Boolean(FUNCTIONS_URL && AUTH_URL);
if (!READY && process.env.CI) {
  throw new Error('AC-TSP-040: SUPABASE_FUNCTIONS_URL + SUPABASE_URL are required in CI — this spec cannot silently skip');
}
if (READY && !SERVICE_KEY) throw new Error('AC-TSP-040: SUPABASE_SERVICE_ROLE_KEY is required whenever the served lane is available.');
test.skip(!READY, 'AC-TSP-040: served-fn lane not configured — run via scripts/serve-functions.sh against the ERPNext bench');

test.setTimeout(240_000);

const signErpWebhook = (rawBody: string): string => createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('base64');

async function countPmoTimesheetState(admin: SupabaseClient) {
  const [sheets, entries, mirrors] = await Promise.all([
    admin.from('timesheets').select('id', { count: 'exact', head: true }),
    admin.from('timesheet_entries').select('id', { count: 'exact', head: true }),
    admin.from('timesheet_erp_mirror').select('id', { count: 'exact', head: true }),
  ]);
  return { sheets: sheets.count ?? -1, entries: entries.count ?? -1, mirrors: mirrors.count ?? -1 };
}

test.describe('AC-TSP-040: a Desk-created Timesheet is never adopted into PMO', () => {
  test('AC-TSP-040 a natively-created ERP Timesheet is ack-and-skipped by BOTH the webhook and the sweep: nothing is minted, and an operator is told', async () => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seeded = await seedTsp(admin, suffix);
    let nativeName: string | null = null;

    try {
      const before = await countPmoTimesheetState(admin);

      // ── An accountant types a week straight into the ERPNext Desk. No PMO command, no mapping. ──
      const nativeDay = runWeek().day1;
      const nativeDoc = (await benchPost('Timesheet', {
        company: ERP_COMPANY,
        employee: ERP_EMPLOYEE,
        time_logs: [
          {
            from_time: `${nativeDay} 09:00:00`,
            to_time: `${nativeDay} 17:00:00`,
            activity_type: ERP_ACTIVITY_TYPE,
            project: seeded.erpProjectA,
          },
        ],
      })) as { name: string; modified: string };
      expect(nativeDoc.name).toMatch(/^TS-/);
      nativeName = nativeDoc.name;
      await benchPut('Timesheet', nativeDoc.name, { docstatus: 1 });

      // ── The inbound webhook (the lossy hint lane). ──
      const rawBody = JSON.stringify({
        doctype: 'Timesheet',
        name: nativeDoc.name,
        docstatus: 1,
        modified: new Date().toISOString(),
        data: {
          doctype: 'Timesheet',
          name: nativeDoc.name,
          docstatus: 1,
          company: ERP_COMPANY,
          employee: ERP_EMPLOYEE,
          total_hours: 8,
          amended_from: null,
        },
      });
      const webhookRes = await fetch(`${FUNCTIONS_URL}/functions/v1/erpnext-webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Frappe-Webhook-Signature': signErpWebhook(rawBody) },
        body: rawBody,
      });
      const webhookBodyText = await webhookRes.text();

      // ── And the sweep, the convergence authority, sees the same document. ──
      const sweep = await runSweep(FUNCTIONS_URL);
      expect(sweep.status, `sweep tick failed: ${JSON.stringify(sweep.body)}`).toBe(200);

      // ⚑ THE GOAL ORACLE — PMO's own books are untouched. Not one hour that nobody approved.
      const after = await countPmoTimesheetState(admin);
      expect(after.sheets, 'no timesheets row was minted from the Desk document').toBe(before.sheets);
      expect(after.entries, 'no timesheet_entries rows were minted').toBe(before.entries);
      expect(after.mirrors, 'no timesheet_erp_mirror row was minted').toBe(before.mirrors);

      // Nor was a mapping claimed for it (a claimed ref would make every LATER event look "already ours").
      const { data: refRows } = await admin
        .from('external_refs')
        .select('id')
        .eq('org_id', ORG_ID)
        .eq('domain', 'timesheets')
        .eq('external_record_id', nativeDoc.name);
      expect(refRows ?? [], 'no external_refs mapping is claimed for a Desk-created Timesheet').toHaveLength(0);

      // …but it is NOT silently dropped: a human is told, and told WHICH document.
      const surfaced = await actionRequiredNotifications(admin, 'timesheet-native-not-adopted', { erpName: nativeDoc.name });
      expect(surfaced.length, 'an action-required names the ERP document').toBeGreaterThan(0);
      expect(surfaced[0].body).toContain(nativeDoc.name);

      // ⚑ …and the ingress ACKS. A 5xx here is not cosmetic: Frappe retries a failed webhook, so an
      // un-adoptable document that answers 500 becomes a permanent retry storm against the client's own
      // ERP — and it reads as an outage rather than as the deliberate never-adopt rule (FR-TSP-082).
      expect(webhookRes.status, `the webhook must ACK an unadoptable document (got ${webhookRes.status}: ${webhookBodyText})`).toBe(200);
    } finally {
      // Leave the bench as we found it: a submitted Timesheet would collide with the next run's hours
      // under ERP's per-employee overlap validation.
      if (nativeName) await benchPut('Timesheet', nativeName, { docstatus: 2 }).catch(() => undefined);
      await admin.from('notifications').delete().eq('org_id', ORG_ID).contains('metadata', { action_required: 'timesheet-native-not-adopted' });
      await cleanupTsp(admin, seeded);
    }
  });
});
