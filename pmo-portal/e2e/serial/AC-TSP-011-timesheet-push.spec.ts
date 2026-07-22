// @e2e-isolation: serial — flips the shared org's external_domain_ownership + org bindings (org-global state).
/**
 * AC-TSP-011 — approval pushes; the ERP doc lands SUBMITTED with the hours and the projects
 * (FR-TSP-060..064, FR-TSP-071, ADR-0059 Posture B).
 *
 * Given an org owning `timesheets`→`erpnext`, a CONFIRMED `erp_employees` link for the author,
 * `project_map` entries for both her projects, and a `Submitted` week with entries across TWO projects
 * and TWO days,
 * When her line manager approves it IN THE APP (the real Approvals queue — no `page.route`, no direct
 * command forging: this is the user's actual journey),
 * Then the sheet becomes `Approved`, an ERP `Timesheet` is committed and SUBMITTED (`docstatus === 1`)
 * whose `time_logs` carry the resolved employee, both resolved ERP projects, the configured activity
 * type and non-overlapping NAIVE datetimes — and NO billing fields (OQ-TSP-4: P3b is costing only);
 * `external_refs('timesheets')` records the mapping; and the side mirror reports `push_state='pushed'`
 * with the ERP name and `erp_total_hours` equal to ERP's OWN server-computed `total_hours` (the
 * ADR-0048 oracle — never PMO's local sum).
 *
 * Run: scripts/with-db-lock.sh scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- \
 *        npx playwright test e2e/serial/AC-TSP-011
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { login } from '../helpers';
import {
  ORG_ID,
  ERP_ACTIVITY_TYPE,
  ERP_EMPLOYEE,
  MANAGER_EMAIL,
  benchGet,
  cleanupTsp,
  readTsMirror,
  runWeek,
  seedTimesheet,
  seedTsp,
} from './_tspHelpers';

/** The queue's own week label (`pages/Approvals.tsx` weekLabel) — the text the manager actually reads. */
function weekUiLabel(weekStart: string): string {
  const [y, m, d] = weekStart.split('-').map(Number);
  return `Week of ${new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const READY = Boolean(FUNCTIONS_URL && AUTH_URL);
if (!READY && process.env.CI) {
  throw new Error('AC-TSP-011: SUPABASE_FUNCTIONS_URL + SUPABASE_URL are required in CI — this spec cannot silently skip');
}
if (READY && !SERVICE_KEY) throw new Error('AC-TSP-011: SUPABASE_SERVICE_ROLE_KEY is required whenever the served lane is available.');
test.skip(!READY, 'AC-TSP-011: served-fn lane not configured — run via scripts/serve-functions.sh against the ERPNext bench');

test.setTimeout(180_000);

interface ErpTimesheetDoc {
  name: string;
  docstatus: number;
  employee: string;
  total_hours: number;
  note: string | null;
  time_logs: Array<Record<string, unknown>>;
}

/** Poll the side mirror until the push settles (the push is a CONSEQUENCE of approval — ADR-0059 §3.2 —
 *  so the UI resolves the approval whether or not ERP has answered yet). */
async function waitForPushState(admin: SupabaseClient, timesheetId: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last: Awaited<ReturnType<typeof readTsMirror>> = null;
  while (Date.now() < deadline) {
    last = await readTsMirror(admin, timesheetId);
    if (last && last.push_state !== 'pending' && last.push_state !== 'pushing') return last;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return last;
}

/** The manager's real journey: open the timesheets approval queue, SELECT this week's entry, read the
 *  preview, approve it. (The Approvals page is a queue + preview split: the queue auto-selects the first
 *  item, so a journey that just clicks "the first Approve" would sign off somebody else's week.) */
async function approveInTheApp(page: Page, weekLabel: string) {
  await login(page, MANAGER_EMAIL);
  await page.goto('/approvals?scope=timesheets');
  await expect(page.getByTestId('approvals-loading')).not.toBeVisible({ timeout: 20_000 });

  const queue = page.getByRole('region', { name: 'Approvals queue' });
  const queueItem = queue.getByRole('button').filter({ hasText: 'Grace TSApprove' }).filter({ hasText: weekLabel });
  await expect(queueItem, "the submitted week is in the manager's approval queue").toBeVisible({ timeout: 20_000 });
  await queueItem.click();

  const preview = page.getByRole('region', { name: 'Approval preview' });
  await expect(preview).toContainText('Grace TSApprove');
  await preview.getByRole('button', { name: /^approve$/i }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog).toContainText("Approve Grace TSApprove's week?");
  await dialog.getByRole('button', { name: /^approve$/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 30_000 });

  // The manager must be TOLD it worked — a silent failure toast here is the journey failing.
  await expect(page.getByText('Timesheet approved', { exact: true })).toBeVisible({ timeout: 30_000 });
  // ...and the approved week leaves the queue.
  await expect(queueItem).toHaveCount(0, { timeout: 20_000 });
}

test.describe('AC-TSP-011: approving a week in the app puts it on the client ledger', () => {
  test('AC-TSP-011 the line manager approves in the Approvals queue and the ERP Timesheet lands SUBMITTED with both projects hours and no billing fields', async ({ page }) => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seeded = await seedTsp(admin, suffix);

    try {
      // A real week: two projects × two days. 4.00 + 3.50 + 2.25 + 1.75 = 11.50 hours.
      const week = runWeek();
      const timesheetId = await seedTimesheet(admin, seeded, {
        status: 'Submitted',
        weekStartDate: week.weekStartDate,
        entries: [
          { projectId: seeded.projectAId, entryDate: week.day1, hours: '4.00' },
          { projectId: seeded.projectBId, entryDate: week.day1, hours: '3.50' },
          { projectId: seeded.projectAId, entryDate: week.day2, hours: '2.25' },
          { projectId: seeded.projectBId, entryDate: week.day2, hours: '1.75' },
        ],
      });

      // ── The user's journey: the line manager approves. ──
      await approveInTheApp(page, weekUiLabel(week.weekStartDate));

      // PMO's own decision committed first (the approval never depends on ERP liveness).
      const { data: sheet } = await admin.from('timesheets').select('status, approved_by, approved_at').eq('id', timesheetId).maybeSingle();
      expect((sheet as { status: string }).status, 'the week is Approved in PMO').toBe('Approved');

      const mirror = await waitForPushState(admin, timesheetId);
      expect(mirror, 'a side-mirror row exists for the approved week').not.toBeNull();
      expect(mirror!.push_state, `push did not land: ${mirror?.push_error ?? '(no error recorded)'}`).toBe('pushed');
      expect(mirror!.ts_number, 'the mirror carries the ERP document name').toBeTruthy();
      expect(mirror!.approved_at_pushed, "the mirror witnesses the approval the push was keyed on").toBe(
        (sheet as { approved_at: string }).approved_at,
      );

      // ── THE GOAL ORACLE: the document on the CLIENT'S ledger, read back from the live bench. ──
      const doc = (await benchGet(`/api/resource/Timesheet/${encodeURIComponent(mirror!.ts_number!)}`)) as ErpTimesheetDoc;
      expect(doc.name).toBe(mirror!.ts_number);
      expect(doc.docstatus, 'the ERP Timesheet is SUBMITTED, not left a draft').toBe(1);
      expect(doc.employee, 'the hours are costed to the CONFIRMED linked Employee').toBe(ERP_EMPLOYEE);
      expect(Number(doc.total_hours), "ERP's own computed total equals the approved week").toBe(11.5);

      // One time_log per entry, carrying the RESOLVED ERP projects (never an omitted dimension).
      expect(doc.time_logs).toHaveLength(4);
      const projects = doc.time_logs.map((l) => l.project);
      expect(projects.filter((p) => p === seeded.erpProjectA), 'project A rows').toHaveLength(2);
      expect(projects.filter((p) => p === seeded.erpProjectB), 'project B rows').toHaveLength(2);
      for (const log of doc.time_logs) {
        expect(log.activity_type, 'the configured activity type is stamped on every row').toBe(ERP_ACTIVITY_TYPE);
        // FR-TSP-063 — naive site-local datetimes; a Z/offset suffix is a raw ERP 500.
        expect(String(log.from_time)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/);
        expect(String(log.to_time)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/);
        // ⚑ OQ-TSP-4 — P3b is COSTING ONLY. A billed hour is a scope violation, not a bonus.
        expect(Number(log.billing_hours ?? 0), 'no billing hours are ever pushed').toBe(0);
        expect(Number(log.billing_rate ?? 0), 'no billing rate is ever pushed').toBe(0);
        expect(Number(log.is_billable ?? 0), 'no row is marked billable').toBe(0);
      }
      // Non-overlapping intervals (FR-TSP-062): sorted by start, each row starts at/after the previous end.
      const intervals = doc.time_logs
        .map((l) => ({ from: String(l.from_time), to: String(l.to_time) }))
        .sort((a, b) => a.from.localeCompare(b.from));
      for (let i = 1; i < intervals.length; i++) {
        expect(intervals[i].from >= intervals[i - 1].to, `time_logs overlap: ${JSON.stringify(intervals)}`).toBe(true);
      }

      // The mirror carries ERP's OWN total verbatim (ADR-0048) — PMO never recomputes it.
      expect(Number(mirror!.erp_total_hours), 'erp_total_hours mirrors ERP verbatim').toBe(Number(doc.total_hours));

      // The mapping is recorded where every later command resolves its ERP target from.
      const { data: refRow } = await admin
        .from('external_refs')
        .select('external_record_id')
        .eq('org_id', ORG_ID)
        .eq('domain', 'timesheets')
        .eq('pmo_record_id', timesheetId)
        .maybeSingle();
      expect((refRow as { external_record_id: string } | null)?.external_record_id, 'external_refs maps the sheet to its ERP document').toBe(
        mirror!.ts_number,
      );
    } finally {
      await cleanupTsp(admin, seeded);
    }
  });
});
