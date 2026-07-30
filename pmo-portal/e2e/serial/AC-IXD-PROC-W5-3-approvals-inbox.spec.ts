// @e2e-isolation: serial — drives the ORG-SHARED /approvals queue (approving a timesheet/procurement
// is a shared-state write), so a parallel worker mutating that queue would make it non-deterministic.
//
// ⚑ `serial` BUYS NO EXCLUSIVE DATA OWNERSHIP. It guarantees only that no OTHER worker writes
// CONCURRENTLY. Every other spec in this lane runs BEFORE this one against the same seed and may
// leave any shared fixture in any state — confusing "no concurrent writer" with "sole owner of the
// data" is how this file broke (2026-07-29): AC-AU-001 re-assigns Tomas Beck's line manager to exec@
// and never restores it, after which `transition_timesheet` (whose approve arm authorises the
// assigned line manager EXCLUSIVELY) refuses pm@ on Tomas's seeded prior-week sheet, so it sits in
// pm@'s queue for the rest of the lane. What this spec actually needs is (a) no concurrent writer —
// hence serial — and (b) TIMESHEETS IT OWNS: the bulk-approve journey below seeds its own authors,
// on its own dedicated week, via the service-role client, and scopes every oracle to those rows.
// Un-quarantined 2026-07-25 (it was `test.fixme`d pending "e2e runs serially", which this lane gives).
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { login, requireServiceRoleKey, SEED_PASSWORD } from '../helpers';

// These journeys MUTATE shared DB state (approve timesheets/procurements). A retry would
// re-run against the already-approved (depleted) fixtures and fail spuriously, so retries
// are disabled — each test must pass on its first deterministic attempt.
test.describe.configure({ retries: 0 });

// ---------------------------------------------------------------------------
// AC-IXD-PROC-W5-3 — /approvals inbox: procurement row → inline preview + approve
// AC-IXD-TS-W5-3  — /approvals inbox: timesheet bulk-approve persists
// AC-IXD-PROC-W5-3-role — role gating: Finance=procurement-only; Engineer=denied
//
// BDD authoring rule (CLAUDE.md §spec-conventions): each test encodes the user's
// REAL, INTUITIVE JOURNEY to the goal and asserts the GOAL/post-state.  The app
// conforms to the test; never weaken an assertion to match current app state.
//
// Seed assumptions (clean `npx supabase db reset`):
//   PROC-2026-002 (id …003): Requested, $22,500, requested_by = Tomas Beck
//     (engineer@acme.test / a4). pm@acme.test (Diego / a2) is an approver (PM role).
//   ⚑ The timesheet journey below assumes NOTHING about seeded timesheets — it brings its own
//     (see the fixture block). The seeded sheets (…004 Tomas/a4, …b4 Wave5 BulkEng) are
//     deliberately no longer load-bearing: whether pm@ may approve them depends on the author's
//     `profiles.manager_id`, which another spec in this lane rewrites and never restores.
// ---------------------------------------------------------------------------

// ── AC-IXD-PROC-W5-3 ────────────────────────────────────────────────────────
// Given: a PM opens /approvals.
// When:  they select the PROC-2026-002 queue row in the two-pane inbox.
// Then:  the preview pane reveals the request details + Approve/Reject there, the URL
//        STAYS on /approvals, and the PM can approve the request without leaving the inbox.
//
// Journey updated (deliberate UX change, per the BDD authoring rule): the two-pane inbox
// now previews the selected queue item in the right pane rather than expanding details
// inside the queue row. The goal-oracle is unchanged — "a PM can act on a procurement
// approval from the inbox" — only the journey/selectors moved.
test(
  'AC-IXD-PROC-W5-3: PM inbox → procurement row previews + approves in place (no navigation)',
  async ({ page }) => {
    await login(page, 'pm@acme.test');
    await page.goto('/approvals?scope=procurement');

    const queue = page.getByRole('region', { name: /approvals queue/i });
    const preview = page.getByRole('region', { name: /approval preview/i });
    await expect(queue).toBeVisible({ timeout: 15_000 });
    await expect(preview).toBeVisible({ timeout: 15_000 });

    const procurementRows = queue.locator('button[aria-pressed]');
    await expect(procurementRows.first()).toBeVisible({ timeout: 15_000 });
    const initialCount = await procurementRows.count();

    // When: select a procurement queue row. The right pane should preview that request.
    await procurementRows.first().click();

    // Goal oracle 1: NO navigation — still inside /approvals, never on a detail route.
    await expect(page).toHaveURL(/\/approvals(?:\?|$)/, { timeout: 5_000 });
    await expect(page).not.toHaveURL(/\/procurement\//);

    // Goal oracle 2: preview + actions render in the right pane for the selected item.
    const previewTitle = preview.getByRole('heading', { level: 2 });
    await expect(previewTitle).toBeVisible({ timeout: 15_000 });
    const title = (await previewTitle.textContent())?.trim() ?? 'request';
    await expect(preview.getByRole('button', { name: /^approve$/i })).toBeVisible();
    await expect(preview.getByRole('button', { name: /^reject$/i })).toBeVisible();

    // Goal oracle 3: the approval confirms and succeeds from the inbox without route-away.
    await preview.getByRole('button', { name: /^approve$/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(new RegExp(`Approve ${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\?`, 'i'), { timeout: 10_000 });
    await dialog.getByRole('button', { name: /^approve$/i }).click();
    await expect(page).toHaveURL(/\/approvals(?:\?|$)/, { timeout: 5_000 });
    await expect(page.getByRole('status')).toContainText(/request approved/i, { timeout: 15_000 });
    await expect(queue.getByRole('button')).toHaveCount(initialCount - 1, { timeout: 15_000 });
  },
);

// ---------------------------------------------------------------------------
// AC-IXD-TS-W5-3 fixture — the timesheets this journey OWNS.
//
// The PM needs ≥2 Submitted weeks he is genuinely AUTHORISED to approve. Both halves of that
// sentence are fixture state some other spec in this lane can take away before this one runs:
//   · `status` — anything that approves/rejects/re-opens a shared seeded sheet;
//   · the AUTHOR's `profiles.manager_id` — `transition_timesheet`'s approve arm authorises the
//     assigned line manager EXCLUSIVELY, and AC-AU-001 re-points a seed author's manager (and
//     restores only the role, not the manager).
// So this journey seeds its OWN authors (run-scoped, deleted afterwards) whose line manager is pm@,
// on a Monday nothing else in the suite uses, and asserts only on that week's rows. A third party's
// sheet — in any week, in any state — is then irrelevant BY CONSTRUCTION rather than by hope.
// ---------------------------------------------------------------------------

/** Diego Salvatierra (pm@acme.test) — the approver whose queue this journey drives. */
const PM_ID = '00000000-0000-0000-0000-0000000000a2';
const ORG_ID = '00000000-0000-0000-0000-000000000001';
/** A seeded Ongoing project — REFERENCED, never mutated, so the seeded weeks carry real hours. */
const ENTRY_PROJECT_ID = '41000000-0000-0000-0000-000000000001';
/** Every author this spec has ever created carries this email prefix — the leftover sweep keys on it. */
const AUTHOR_EMAIL_PREFIX = 'ac-ixd-ts-w53-';
/** ≥2 is the whole point of BULK approve (the RQ-v5 concurrent-mutate bug needed ≥2 to reproduce). */
const OWN_SHEETS = 2;

const SERVICE_KEY = requireServiceRoleKey() ?? '';
const SERVICE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
if (SERVICE_KEY && !SERVICE_URL) {
  throw new Error(
    'AC-IXD-TS-W5-3: SUPABASE_URL (or VITE_SUPABASE_URL) must be exported alongside SUPABASE_SERVICE_ROLE_KEY — never a silent skip',
  );
}
/** Gate on the DEPENDENCY this fixture needs (the service-role client), never on the environment. */
const READY = Boolean(SERVICE_KEY && SERVICE_URL);

/**
 * A Monday NOTHING else in the suite uses: 20 weeks before the current one.
 *
 * `seed.sql` seeds the current and the prior week (relative to Postgres `current_date`); the ERPNext
 * lane allocates far-FUTURE weeks (`_tspHelpers.runWeek`, 2027+). 20 weeks back clears both by a
 * margin no host/DB timezone skew can close, and `week_is_monday` (migration 0001) demands a Monday.
 * The week is CHOSEN by the test and written to the DB, then read back out of the DOM, so — unlike
 * the previous "prior ISO week computed in the browser clock" — no clock agreement is required.
 */
function ownedWeekStart(): string {
  const now = new Date();
  const mondayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - ((now.getUTCDay() + 6) % 7),
  );
  return new Date(mondayUtc - 20 * 7 * 86_400_000).toISOString().slice(0, 10);
}

/** The ISO date `offset` days into `weekStart`. */
function dayOf(weekStart: string, offset: number): string {
  return new Date(Date.parse(`${weekStart}T00:00:00.000Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}

interface OwnedWeek {
  weekStart: string;
  userIds: string[];
  timesheetIds: string[];
}

/**
 * Delete every author this spec has ever created, and their weeks.
 *
 * Runs BEFORE seeding as well as after: a run that died between seed and cleanup would otherwise
 * leave Submitted rows on the owned week and re-couple the oracle to somebody else's leftovers —
 * the exact failure mode this fixture exists to end.
 */
async function sweepOwnAuthors(client: SupabaseClient): Promise<void> {
  const { data } = await client.from('profiles').select('id').like('email', `${AUTHOR_EMAIL_PREFIX}%`);
  for (const row of (data ?? []) as Array<{ id: string }>) {
    const { data: sheets } = await client.from('timesheets').select('id').eq('user_id', row.id);
    for (const sheet of (sheets ?? []) as Array<{ id: string }>) {
      // Best-effort: on an org flipped to ERPNext the push side-tables would FK-block the delete.
      await client.from('external_command_outbox').delete().eq('domain', 'timesheets').eq('pmo_record_id', sheet.id);
      await client.from('external_refs').delete().eq('domain', 'timesheets').eq('pmo_record_id', sheet.id);
      await client.from('external_ref_lineage').delete().eq('domain', 'timesheets').eq('pmo_record_id', sheet.id);
      await client.from('timesheet_erp_mirror').delete().eq('timesheet_id', sheet.id);
      await client.from('timesheets').delete().eq('id', sheet.id); // entries cascade
    }
    await client.from('profiles').delete().eq('id', row.id);
    await client.auth.admin.deleteUser(row.id).catch(() => undefined);
  }
}

/** Seed `count` authors line-managed by pm@, each with one Submitted week of real hours. */
async function seedOwnedSubmittedWeeks(client: SupabaseClient, count: number): Promise<OwnedWeek> {
  const weekStart = ownedWeekStart();
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const seeded: OwnedWeek = { weekStart, userIds: [], timesheetIds: [] };

  for (let i = 0; i < count; i++) {
    const email = `${AUTHOR_EMAIL_PREFIX}${i}-${suffix}@acme.test`;
    const { data: created, error: userErr } = await client.auth.admin.createUser({
      email,
      password: SEED_PASSWORD,
      email_confirm: true,
    });
    if (userErr || !created.user) throw new Error(`AC-IXD-TS-W5-3 seed author failed: ${userErr?.message}`);
    seeded.userIds.push(created.user.id);

    // manager_id = pm@ is what AUTHORISES the approve (transition_timesheet, migration 0164).
    const { error: profileErr } = await client.from('profiles').upsert(
      {
        id: created.user.id,
        org_id: ORG_ID,
        email,
        full_name: `W5-3 Bulk Author ${i + 1}`,
        role: 'Engineer',
        title: 'Field Engineer',
        manager_id: PM_ID,
        status: 'active',
      },
      { onConflict: 'id' },
    );
    if (profileErr) throw new Error(`AC-IXD-TS-W5-3 seed profile failed: ${profileErr.message}`);

    const timesheetId = crypto.randomUUID();
    const { error: sheetErr } = await client.from('timesheets').insert({
      id: timesheetId,
      org_id: ORG_ID,
      user_id: created.user.id,
      week_start_date: weekStart,
      status: 'Submitted',
      submitted_at: new Date().toISOString(),
    });
    if (sheetErr) throw new Error(`AC-IXD-TS-W5-3 seed timesheet failed: ${sheetErr.message}`);
    seeded.timesheetIds.push(timesheetId);

    const { error: entryErr } = await client.from('timesheet_entries').insert([
      { org_id: ORG_ID, timesheet_id: timesheetId, project_id: ENTRY_PROJECT_ID, entry_date: dayOf(weekStart, 0), hours: 8, notes: 'Site works' },
      { org_id: ORG_ID, timesheet_id: timesheetId, project_id: ENTRY_PROJECT_ID, entry_date: dayOf(weekStart, 1), hours: 6, notes: 'Commissioning' },
    ]);
    if (entryErr) throw new Error(`AC-IXD-TS-W5-3 seed entries failed: ${entryErr.message}`);
  }

  return seeded;
}

let admin: SupabaseClient | null = null;
let owned: OwnedWeek | null = null;

// The shared local stack is left EXACTLY as found — the next spec in the lane inherits the seed,
// not this journey's authors. (The absence of that discipline is what broke this file.)
test.afterEach(async () => {
  if (!admin || !owned) return;
  await sweepOwnAuthors(admin);
  owned = null;
});

// ── AC-IXD-TS-W5-3 ──────────────────────────────────────────────────────────
// Given: a PM whose approval queue holds ≥2 Submitted weeks he is authorised to approve
//        (the fixture above: two run-scoped authors line-managed by pm@, on the week this
//        spec owns — no seeded sheet, and no other spec's leftovers, are involved).
// When:  pm@ enters Select mode, selects every row of that owned week, clicks "Approve N",
//        and confirms the dialog.
// Then:  (a) the confirm dialog CLOSES, (b) the toolbar label and the dialog name the same N,
//        (c) those weeks are gone from the queue after a fresh server re-fetch (reload-safe), and
//        (d) server-side every one of them is Approved BY THIS PM.
//
// Goal-oracle: "a PM bulk-approves ≥2 timesheets in one confirm from the inbox and they are really,
// durably approved" — the REAL multi-row journey the bug (RQ v5 concurrent-mutate callbacks dropped)
// broke. UNCHANGED by the 2026-07-29 fix: only the DATA the journey acts on, and the PRECISION of the
// row locator ("any row that happens to share a week-start" → "the rows this test approved"), moved.
// Oracle (d) is NEW and is a strengthening, not a relaxation: `commitBulk` closes the dialog and
// folds a PARTIAL failure into a warning toast, so "the dialog closed" never proved on its own that
// every selected week was actually approved.
//
// Seed-name-robustness (binding): NO seed person-name is asserted anywhere. Rows are targeted
// structurally, by the `[data-week-start]` of the week this spec owns (ApprovalsQueue.tsx).
//
// Viewport (owner decision 2026-07-27, option 1): bulk-approve lives ONLY in the stacked fallback
// that renders below the `lg` breakpoint (1024px, Approvals.tsx TRIAGE_QUERY). The redesign dropped
// bulk from the primary split inbox; whether that was deliberate is an OPEN QUESTION
// (docs/backlog.md). Until it is answered this test drives the real Select → checkboxes →
// "Approve N" → ConfirmDialog path at a small viewport. If bulk is restored to the split inbox,
// drop the setViewportSize — the goal-oracle carries over unchanged.
test(
  'AC-IXD-TS-W5-3 the PM bulk-approves ≥2 timesheets from the STACKED (<1024px) approvals inbox and the queue count settles',
  async ({ page }) => {
    test.skip(
      !READY,
      'AC-IXD-TS-W5-3: needs the service-role client (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) to seed the weeks it owns',
    );

    // Arrange: this journey's OWN Submitted weeks (see the fixture block above).
    admin = createClient(SERVICE_URL, SERVICE_KEY);
    await sweepOwnAuthors(admin);
    owned = await seedOwnedSubmittedWeeks(admin, OWN_SHEETS);
    const weekStart = owned.weekStart;

    // Step 1: pm@ opens /approvals — his queue holds the ≥2 Submitted weeks seeded above.
    await login(page, 'pm@acme.test');
    // Force the stacked fallback (ApprovalsQueue) by going BELOW the lg breakpoint (1024px).
    // The split inbox renders at ≥1024px and has NO bulk-approve affordance; the fallback has it.
    await page.setViewportSize({ width: 800, height: 1000 });
    // CW-6: a PM sees both modules as deep-linkable scope tabs; this test exercises the
    // timesheet queue, so it deep-links straight to that scope.
    await page.goto('/approvals?scope=timesheets');

    // Timesheet section visible.
    const tsSection = page.getByRole('region', { name: /timesheets awaiting you/i });
    await expect(tsSection).toBeVisible({ timeout: 15_000 });

    // The Select button is only shown when there are approvable rows — its presence confirms at
    // least one Submitted sheet is in the queue. The exact owned count is asserted structurally
    // below (and again via the "Approve N" label).
    const selectBtn = tsSection.getByRole('button', { name: /^select$/i });
    await expect(selectBtn).toBeVisible({ timeout: 15_000 });

    // Enter Select mode.
    await selectBtn.click();

    // The bulk-action toolbar appears.
    const bulkGroup = page.getByRole('group', { name: /bulk approve/i });
    await expect(bulkGroup).toBeVisible({ timeout: 5_000 });

    // Select every row of the week this test OWNS. Each row wraps its checkbox in a
    // [data-week-start] container (ApprovalsQueue.tsx), and on the owned week those are exactly the
    // OWN_SHEETS rows seeded above — nobody else ever writes this week.
    const ownRows = tsSection.locator(`[data-week-start="${weekStart}"]`);
    const ownCheckboxes = ownRows.getByRole('checkbox');
    await expect(ownCheckboxes).toHaveCount(OWN_SHEETS, { timeout: 15_000 });
    const ownCount = await ownCheckboxes.count();
    expect(ownCount, 'BULK approve means ≥2 rows in one confirm').toBeGreaterThanOrEqual(2);

    for (let i = 0; i < ownCount; i++) {
      await ownCheckboxes.nth(i).click();
    }

    // "Approve N" (N = ownCount ≥ 2) button becomes enabled.
    const approveNBtn = bulkGroup.getByRole('button', { name: /^approve \d+$/i });
    await expect(approveNBtn).toBeVisible({ timeout: 5_000 });
    await expect(approveNBtn).toBeEnabled();

    // Capture N from the button label and assert it counts exactly the rows selected.
    const approveLabel = (await approveNBtn.textContent()) ?? '';
    const nMatch = approveLabel.match(/approve (\d+)/i);
    const n = nMatch ? parseInt(nMatch[1], 10) : ownCount;
    expect(n).toBe(ownCount);
    expect(n).toBeGreaterThanOrEqual(2);

    // Click "Approve N" → stages the bulk ConfirmDialog.
    await approveNBtn.click();

    // Confirm the bulk dialog.
    const bulkDialog = page.getByRole('dialog');
    await expect(bulkDialog).toBeVisible({ timeout: 5_000 });

    // Dialog title mentions N.
    await expect(bulkDialog).toContainText(`Approve ${n} timesheet`);

    // Confirm button label matches.
    const confirmBtn = bulkDialog.getByRole('button', { name: `Approve ${n}`, exact: true });
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // Goal oracle (a): the confirm dialog CLOSES (was stuck indefinitely with the RQ v5 bug).
    await expect(bulkDialog).not.toBeVisible({ timeout: 20_000 });

    // (The transient "N timesheets approved" toast is asserted at the UNIT level
    // [ApprovalsQueue.expand-bulk test], not here: on slow CI runners it auto-dismisses before the
    // dialog-close wait above resolves, making an e2e toast check racy. Oracles (c) + (d) below
    // prove the bulk approve succeeded server-side.)

    // Goal oracle (c) — reload-safe: navigate away and back to force a fresh server query — the
    // approved weeks MUST NOT reappear (tests real server persistence, not optimistic UI).
    await page.goto('/');
    await page.goto('/approvals?scope=timesheets');

    // Wait for the section to re-render from fresh data.
    await expect(tsSection).toBeVisible({ timeout: 15_000 });

    // Cross-check: the inbox settled (not loading) confirms this is not a pending-mask.
    await expect(page.getByTestId('approvals-loading')).not.toBeVisible({ timeout: 5_000 });
    await expect(tsSection.locator(`[data-week-start="${weekStart}"]`)).toHaveCount(0, { timeout: 15_000 });

    // Goal oracle (d) — server truth: every week the PM selected is Approved, BY HIM.
    const { data: after, error: readErr } = await admin
      .from('timesheets')
      .select('id, status, approved_by')
      .in('id', owned.timesheetIds);
    expect(readErr, 'the post-state read must succeed').toBeNull();
    const rows = (after ?? []) as Array<{ id: string; status: string; approved_by: string | null }>;
    expect(rows).toHaveLength(OWN_SHEETS);
    for (const row of rows) {
      expect(row.status, `timesheet ${row.id} is Approved server-side`).toBe('Approved');
      expect(row.approved_by, `timesheet ${row.id} is approved BY the PM who confirmed`).toBe(PM_ID);
    }
  },
);


// ── AC-IXD-PROC-W5-3-role (thin gating coverage) ───────────────────────────
// ADR-0010: role-gating logic is well unit-tested (Approvals.test.tsx).  This thin
// slice confirms the gate actually fires in the rendered app (not just in unit state).
//
// Finance: sees procurement section; does NOT see timesheet section.
test(
  'AC-IXD-PROC-W5-3-role: Finance at /approvals sees procurement section only (no timesheet section)',
  async ({ page }) => {
    await login(page, 'finance@acme.test');
    await page.goto('/approvals');

    const queue = page.getByRole('region', { name: /approvals queue/i });
    await expect(queue).toBeVisible({ timeout: 15_000 });

    // Finance can approve procurement, so the procurement queue group is present.
    await expect(queue.getByRole('heading', { name: /purchase requests/i })).toBeVisible({ timeout: 15_000 });

    // Finance cannot approve timesheets, so there is no timesheet tab/lane in the two-pane inbox.
    await expect(page.getByRole('tab', { name: /timesheets/i })).toHaveCount(0);
    await expect(queue.getByRole('heading', { name: /^timesheets$/i })).toHaveCount(0);
  },
);

// Engineer: role cannot approve either → AccessDenied surface.
test(
  'AC-IXD-PROC-W5-3-role: Engineer at /approvals is denied (AccessDenied surface rendered)',
  async ({ page }) => {
    await login(page, 'engineer@acme.test');
    await page.goto('/approvals');

    // Goal: the AccessDenied surface is shown (not just an empty inbox).
    // Approvals.tsx renders AccessDenied with a "Back" / navigation affordance.
    await expect(page.getByText(/you don.t have access to approvals/i)).toBeVisible({ timeout: 15_000 });

    // Neither section renders.
    await expect(
      page.getByRole('region', { name: /purchase requests awaiting you/i }),
    ).not.toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByRole('region', { name: /timesheets awaiting you/i }),
    ).not.toBeVisible({ timeout: 5_000 });
  },
);
