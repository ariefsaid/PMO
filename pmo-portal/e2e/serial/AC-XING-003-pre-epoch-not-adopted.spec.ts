// @e2e-isolation: serial — flips the shared org's external_domain_ownership + org bindings (org-global state).
/**
 * AC-XING-003 — the ERPNext crossing (#481, step 4 of #590): a pre-epoch ERPNext document mints no
 * PMO process record (A3, `OD-XING-1`).
 *
 * ⚑ The date is not the mechanism. Never-adopt (ADR-0059 §5) is date-independent: PMO owns timesheet
 * entry AND approval (Posture B), so a `Timesheet` created directly on the ERPNext Desk is NEVER
 * adopted regardless of when its `time_logs` fall — `AC-TSP-040` already proves that in general. This
 * spec's only addition is dating the Desk document BEFORE the binding's `activated_at`, so the
 * crossing story is concrete: a document that predates the connection is a read-model/notification
 * event and never a PMO record. There is no epoch filter in the tree — see the plan's P-4 — so this
 * spec exercises the SAME never-adopt code path as `AC-TSP-040`, dated to make the point.
 *
 * Run: scripts/with-db-lock.sh scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- \
 *        npx playwright test e2e/serial/AC-XING-003
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
  seedTsp,
} from './_tspHelpers';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const READY = Boolean(FUNCTIONS_URL && AUTH_URL);
if (FUNCTIONS_URL && !READY) {
  throw new Error('AC-XING-003: SUPABASE_FUNCTIONS_URL + SUPABASE_URL are required once the served lane is up (SUPABASE_FUNCTIONS_URL set) — never a silent skip');
}
if (READY && !SERVICE_KEY) throw new Error('AC-XING-003: SUPABASE_SERVICE_ROLE_KEY is required whenever the served lane is available.');
test.skip(!READY, 'AC-XING-003: served-fn lane not configured — run via scripts/serve-functions.sh against the ERPNext bench');

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

test('AC-XING-003 a Desk-created Timesheet dated BEFORE the binding activated is ack-and-skipped: nothing is minted, and an operator is told', async () => {
  const admin = createClient(AUTH_URL, SERVICE_KEY);
  let priorActivatedAt: string | null = null;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const seeded = await seedTsp(admin, suffix);
  let nativeName: string | null = null;

  try {
    // Back-date activation by one day (same shape as AC-XING-001).
    const activatedAt = new Date(Date.now() - 24 * 3600_000).toISOString();
    // Snapshot the org-global stamp so `finally` can put it back (e2e-parallel-conventions §3.3).
    const { data: priorBinding } = await admin.from('external_org_bindings').select('activated_at')
      .eq('org_id', ORG_ID).eq('external_tier', 'erpnext').maybeSingle();
    priorActivatedAt = priorBinding?.activated_at ?? null;
    const { error: bindErr } = await admin.from('external_org_bindings')
      .update({ activated_at: activatedAt })
      .eq('org_id', ORG_ID).eq('external_tier', 'erpnext');
    expect(bindErr).toBeNull();

    const before = await countPmoTimesheetState(admin);

    // ── An accountant types a PRE-EPOCH week straight into the ERPNext Desk. No PMO command, no mapping. ──
    const fromTime = new Date(Date.parse(activatedAt) - 48 * 3600_000);
    const toTime = new Date(fromTime.getTime() + 3600_000);
    const fmt = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
    const nativeDoc = (await benchPost('Timesheet', {
      company: ERP_COMPANY,
      employee: ERP_EMPLOYEE,
      time_logs: [
        {
          from_time: fmt(fromTime),
          to_time: fmt(toTime),
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
        total_hours: 1,
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
    expect(after.sheets, 'no timesheets row was minted from the pre-epoch Desk document').toBe(before.sheets);
    expect(after.entries, 'no timesheet_entries rows were minted').toBe(before.entries);
    expect(after.mirrors, 'no timesheet_erp_mirror row was minted').toBe(before.mirrors);

    // Nor was a mapping claimed for it (a claimed ref would make every LATER event look "already ours").
    const { data: refRows, error: refErr } = await admin
      .from('external_refs')
      .select('id')
      .eq('org_id', ORG_ID)
      .eq('domain', 'timesheets')
      .eq('external_record_id', nativeDoc.name);
    expect(refErr, 'the external_refs query itself must succeed — a failed query is not "no rows"').toBeNull();
    expect(refRows ?? [], 'no external_refs mapping is claimed for a pre-epoch Desk-created Timesheet').toHaveLength(0);

    // …but it is NOT silently dropped: a human is told, and told WHICH document.
    const surfaced = await actionRequiredNotifications(admin, 'timesheet-native-not-adopted', { erpName: nativeDoc.name });
    expect(surfaced.length, 'an action-required names the ERP document').toBeGreaterThan(0);
    expect(surfaced[0].body).toContain(nativeDoc.name);

    // ⚑ …and the ingress ACKS. A 5xx here would turn an un-adoptable document into a permanent retry
    // storm against the client's own ERP (Frappe retries a failed webhook), reading as an outage rather
    // than as the deliberate never-adopt rule (FR-TSP-082).
    expect(webhookRes.status, `the webhook must ACK an unadoptable document (got ${webhookRes.status}: ${webhookBodyText})`).toBe(200);
  } finally {
    // Leave the bench as we found it: a submitted Timesheet would collide with the next run's hours
    // under ERP's per-employee overlap validation.
    if (nativeName) await benchPut('Timesheet', nativeName, { docstatus: 2 }).catch(() => undefined);
    await admin.from('notifications').delete().eq('org_id', ORG_ID).contains('metadata', { action_required: 'timesheet-native-not-adopted' });
    await cleanupTsp(admin, seeded);
    if (priorActivatedAt !== null) {
      await admin.from('external_org_bindings').update({ activated_at: priorActivatedAt })
        .eq('org_id', ORG_ID).eq('external_tier', 'erpnext');
    }
  }
});
