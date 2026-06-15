import { test, expect } from '@playwright/test';
import { login } from './helpers';

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
//   timesheets …001 (Tomas/a4): Draft — current-week sheet for engineer@.
//   timesheets …002 (Diego/a2): Draft — pm@'s OWN sheet; SoD excludes from queue.
//   timesheets …004 (Tomas/a4): prior-week Submitted — approvable by pm@ (manager).
//   Grace/b1 (ts-approve-eng@) + Heidi/b2 (ts-approve-mgr@): dedicated AC-911 actors;
//     not disturbed by these tests.
//   b4 (wave5-bulkeng@, no auth.users — never logs in): DEDICATED bulk-approve fixture.
//     Prior-week timesheet (…b4) seeded as Submitted, manager_id = pm@.
//   Together …004 + …b4 guarantee ≥2 Submitted sheets in pm@'s queue on any clean reset.
//
// AC-IXD-TS-W5-3 seed-name-robustness: no person name is asserted anywhere in the test.
// The journey is driven STRUCTURALLY (Select All → count ≥2 → approve → empty sentinel),
// so renaming a seed profile can never break this spec.
// ---------------------------------------------------------------------------

// ── AC-IXD-PROC-W5-3 ────────────────────────────────────────────────────────
// Given: a PM opens /approvals.
// When:  they expand the PROC-2026-002 row's budget-impact disclosure.
// Then:  the row reveals the budget impact + an adjacent Approve/Reject IN PLACE and
//        the URL STAYS on /approvals — the approve decision is made from the inbox, NOT
//        on a separate detail screen.
//
// Journey updated (deliberate UX change, per the BDD authoring rule): intent-fix-wave
// IF-A (AC-IFW-PROC-01) replaced the CW-6 route-away with preview-in-place, so the
// procurement row now mirrors the timesheet row's expand-and-approve paradigm. The
// goal-oracle is unchanged — "a PM can act on a procurement approval from the inbox" —
// only the journey (expand in place vs drill in) moved.
test(
  'AC-IXD-PROC-W5-3: PM inbox → procurement row previews + approves in place (no navigation)',
  async ({ page }) => {
    await login(page, 'pm@acme.test');
    await page.goto('/approvals?scope=procurement');

    // Procurement section is visible (PM role can approve procurement).
    const procSection = page.getByRole('region', { name: /purchase requests awaiting you/i });
    await expect(procSection).toBeVisible({ timeout: 15_000 });

    // PROC-2026-002 listed in the inbox.
    await expect(procSection.getByText('Safety Equipment & PPE')).toBeVisible({ timeout: 15_000 });
    await expect(procSection.getByText('PROC-2026-002')).toBeVisible({ timeout: 10_000 });

    // Collapsed: the Approve affordance is NOT yet shown — it lives behind the row's
    // budget-impact disclosure (preview-before-decide), not on a separate screen.
    await expect(procSection.getByRole('button', { name: /^approve$/i })).not.toBeVisible();

    // When: expand the row in place via its budget-impact disclosure.
    await procSection
      .getByRole('button', { name: /show budget impact for Safety Equipment & PPE/i })
      .click();

    // Goal oracle 1: NO navigation — the decision is made in the inbox, URL unchanged.
    await expect(page).toHaveURL(/\/approvals/, { timeout: 5_000 });
    await expect(page).not.toHaveURL(/\/procurement\//);

    // Goal oracle 2: Approve/Reject are now adjacent IN the expanded row (real cross-stack
    // detail fetch resolved), reachable without drilling in.
    await expect(procSection.getByRole('button', { name: /^approve$/i })).toBeVisible({ timeout: 15_000 });
    await expect(procSection.getByRole('button', { name: /^reject$/i })).toBeVisible();

    // Goal oracle 3: clicking Approve stages the confirm dialog IN the inbox (still no nav) —
    // the approval is wired through the same confirm path, from the inbox.
    await procSection.getByRole('button', { name: /^approve$/i }).click();
    await expect(page.getByText(/Approve Safety Equipment & PPE\?/i)).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/approvals/);
  },
);

// ── AC-IXD-TS-W5-3 ──────────────────────────────────────────────────────────
// Given: a PM opens /approvals where ≥2 Submitted prior-week sheets are in the queue.
//        The seed guarantees ≥2 prior-week fixtures: Wave5 BulkEng (b4) and Tomas
//        Beck/Engineer (a4).  Both have manager_id = pm@ (a2) and are seeded as
//        Submitted for the prior ISO week — no UI-submit step needed.
// When:  pm@ enters Select mode, selects every PRIOR-WEEK approvable row (≥2 count),
//        clicks "Approve N", and confirms the dialog.
// Then:  (a) the confirm dialog CLOSES, (b) a success/aggregate toast matching
//        /timesheets? approved/i appears, (c) the prior-week approved rows leave the
//        queue after a fresh server re-fetch (reload-safe).
//
// Goal-oracle: "a PM can bulk-approve ≥2 timesheets in one confirm from the inbox" —
// the REAL multi-row journey the bug (RQ v5 concurrent-mutate callbacks dropped) broke.
//
// Seed-name-robustness (binding): NO person-name string assertion anywhere in this test.
// The journey targets rows by their [data-week-start] attribute (prior ISO week Monday,
// YYYY-MM-DD), computed dynamically in the browser's UTC clock (same TZ pin as the seed
// `date_trunc('week', current_date)`).  Renaming a seed profile can NEVER break this spec.
//
// Parallel-isolation: selecting ONLY prior-week rows avoids races with other specs that
// submit current-week sheets (e.g. AC-911 submits Grace/b1's current-week Draft).
// pm@ (Project Manager role) sees all org timesheets via RLS, but only the prior-week
// seeded fixtures are selectable here, so pm@'s attempt to approve Grace's sheet (whose
// manager is Heidi/b2, not pm@) is not triggered and AC-911 is not disturbed.
//
// Isolation: seeded sheets (b4 + a4 prior-week) are untouched by other specs (AC-TSE-021
// uses a4's CURRENT-week Draft on a future empty week; AC-911 uses Grace/b1 + Heidi/b2;
// AC-IXD-TS-001 uses ts-colocated-eng@/b3).
test(
  'AC-IXD-TS-W5-3: PM bulk-approves ≥2 awaiting timesheets; dialog closes, toast fires, approved weeks leave queue (reload-safe)',
  async ({ page }) => {
    // Step 1: pm@ opens /approvals — ≥2 prior-week Submitted sheets are already in the
    // queue (seeded as Submitted; no UI-submit step needed).
    await login(page, 'pm@acme.test');
    // CW-6: a PM sees both modules as deep-linkable scope tabs; this test exercises the
    // timesheet queue, so it deep-links straight to that scope.
    await page.goto('/approvals?scope=timesheets');

    // Timesheet section visible.
    const tsSection = page.getByRole('region', { name: /timesheets awaiting you/i });
    await expect(tsSection).toBeVisible({ timeout: 15_000 });

    // The Select button is only shown when there are approvable rows — its presence
    // confirms at least one Submitted sheet is in the queue.  We assert ≥2 structurally
    // below (via the "Approve N" label after selecting all prior-week rows).
    const selectBtn = tsSection.getByRole('button', { name: /^select$/i });
    await expect(selectBtn).toBeVisible({ timeout: 15_000 });

    // Compute the prior ISO-week Monday (YYYY-MM-DD) in the browser's UTC clock.
    // This matches the seed's `(date_trunc('week', current_date) - interval '7 days')::date`
    // because Playwright pins timezoneId: 'UTC' in playwright.config.ts.
    const priorWeekStart: string = await page.evaluate(() => {
      const today = new Date();
      const dow = today.getDay(); // 0=Sun … 6=Sat
      const daysSinceMonday = dow === 0 ? 6 : dow - 1;
      const thisMonday = new Date(today);
      thisMonday.setDate(today.getDate() - daysSinceMonday);
      const lastMonday = new Date(thisMonday);
      lastMonday.setDate(thisMonday.getDate() - 7);
      const y = lastMonday.getFullYear();
      const m = String(lastMonday.getMonth() + 1).padStart(2, '0');
      const d = String(lastMonday.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    });

    // Enter Select mode.
    await selectBtn.click();

    // The bulk-action toolbar appears.
    const bulkGroup = page.getByRole('group', { name: /bulk approve/i });
    await expect(bulkGroup).toBeVisible({ timeout: 5_000 });

    // Select ONLY the prior-week dedicated fixtures (isolation-safe: excludes any
    // current-week sheets submitted by other concurrent tests like AC-911/Grace).
    // Each row wraps its checkbox in a [data-week-start] container (ApprovalsQueue.tsx).
    const priorWeekRows = tsSection.locator(`[data-week-start="${priorWeekStart}"]`);
    const priorWeekCheckboxes = priorWeekRows.getByRole('checkbox');
    const priorCount = await priorWeekCheckboxes.count();

    // Both prior-week fixtures (b4 Wave5 BulkEng + a4 Tomas Beck) must be present.
    // This is the structural ≥2 assertion — no hardcoded person names.
    expect(priorCount).toBeGreaterThanOrEqual(2);

    // Click each prior-week checkbox (equivalent to "select all approvable" for the
    // dedicated fixtures — exercises the real multi-row concurrent-approve path).
    for (let i = 0; i < priorCount; i++) {
      await priorWeekCheckboxes.nth(i).click();
    }

    // "Approve N" (N = priorCount ≥ 2) button becomes enabled.
    const approveNBtn = bulkGroup.getByRole('button', { name: /^approve \d+$/i });
    await expect(approveNBtn).toBeVisible({ timeout: 5_000 });
    await expect(approveNBtn).toBeEnabled();

    // Capture N from the button label and assert it equals the prior-week count.
    const approveLabel = (await approveNBtn.textContent()) ?? '';
    const nMatch = approveLabel.match(/approve (\d+)/i);
    const n = nMatch ? parseInt(nMatch[1], 10) : priorCount;
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

    // Goal oracle (b): aggregate success toast appears confirming timesheets approved.
    // All N selected are prior-week fixtures pm@ is authorized to approve → no partial failure.
    await expect(page.getByText(/timesheets? approved/i)).toBeVisible({ timeout: 15_000 });

    // Goal oracle (c) — reload-safe: navigate away and back to force a fresh server query —
    // approved prior-week rows MUST NOT reappear (tests real server persistence, not optimistic UI).
    await page.goto('/');
    await page.goto('/approvals?scope=timesheets');

    // Wait for the section to re-render from fresh data.
    await expect(tsSection).toBeVisible({ timeout: 15_000 });

    // The prior-week rows are gone.  The structural oracle is the absence of any
    // [data-week-start] row for the prior week — no person names asserted.
    // Cross-check: the inbox settled (not loading) confirms this is not a pending-mask.
    await expect(page.getByTestId('approvals-loading')).not.toBeVisible({ timeout: 5_000 });
    await expect(tsSection.locator(`[data-week-start="${priorWeekStart}"]`)).toHaveCount(0, { timeout: 15_000 });
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

    // Finance can approve procurement (role: Finance → can('transition','procurement')).
    const procSection = page.getByRole('region', { name: /purchase requests awaiting you/i });
    await expect(procSection).toBeVisible({ timeout: 15_000 });

    // Finance cannot approve timesheets (Finance excluded from approval.transition).
    const tsSection = page.getByRole('region', { name: /timesheets awaiting you/i });
    await expect(tsSection).not.toBeVisible({ timeout: 5_000 });
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
