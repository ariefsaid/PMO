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
//   timesheets …001 (Dave, a4): Draft — current-week sheet for the shared engineer@.
//   timesheets …002 (Alice, a2): Draft — Alice's OWN sheet; SoD excludes from her queue.
//   Grace/b1 (ts-approve-eng@) + Heidi/b2 (ts-approve-mgr@): dedicated AC-911 actors;
//     not disturbed by these tests.
//   Wave5 BulkEng / b4 (no auth.users — never logs in): DEDICATED AC-IXD-TS-W5-3 actor.
//     Their prior-week timesheet (…b4) is seeded as Submitted so pm@ can bulk-approve
//     it without any Dave→Submit step — the shared-state collision that broke CI.
//
// AC-IXD-TS-W5-3 isolation: the test uses ONLY the b4 fixture (never touches Dave's
// sheet), making it ordering-independent across the full parallel/serial suite.
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
// Given: a PM opens /approvals where ≥2 Submitted prior-week sheets are in the queue:
//        Wave5 BulkEng (b4, dedicated fixture) AND Engineer/Dave (a4, prior-week Submitted).
//        Both are pre-seeded as Submitted; no UI-submit step needed.
// When:  pm@ (Alice) enters Select mode, clicks "Select All" (selects ≥2 rows),
//        clicks "Approve N", and confirms the dialog.
// Then:  (a) the confirm dialog CLOSES, (b) a success/aggregate toast fires,
//        (c) the approved rows leave the queue after a fresh server re-fetch (reload-safe).
//
// Goal-oracle: "a PM can bulk-approve ≥2 timesheets in one confirm from the inbox" —
// the REAL multi-row journey the bug (RQ v5 concurrent-mutate callbacks dropped) broke.
//
// Isolation: both seeded sheets (b4 + a4 prior-week) are untouched by other specs in
// the suite. Dave's prior-week Submitted sheet (…000004) is not mutated by any other
// e2e (AC-TSE-021 uses Dave's CURRENT-week Draft; AC-911 uses Grace/b1 + Heidi/b2).
test(
  'AC-IXD-TS-W5-3: PM bulk-approves ≥2 awaiting timesheets; dialog closes, toast fires, approved weeks leave queue (reload-safe)',
  async ({ page }) => {
    // Step 1: Alice (pm@) opens /approvals — both Wave5 BulkEng (b4) and Engineer/Dave (a4)
    // prior-week Submitted sheets are already in the queue (no Dave→Submit pre-step needed).
    await login(page, 'pm@acme.test');
    // CW-6: a PM sees both modules as deep-linkable scope tabs; this test exercises the
    // timesheet queue, so it deep-links straight to that scope.
    await page.goto('/approvals?scope=timesheets');

    // Timesheet section visible.
    const tsSection = page.getByRole('region', { name: /timesheets awaiting you/i });
    await expect(tsSection).toBeVisible({ timeout: 15_000 });

    // Both rows must be visible (≥2 submitted sheets in the queue for the real bulk path).
    await expect(tsSection.getByText('Wave5 BulkEng')).toBeVisible({ timeout: 15_000 });

    // Enter Select mode.
    await tsSection.getByRole('button', { name: /^select$/i }).click();

    // The bulk-action toolbar appears.
    const bulkGroup = page.getByRole('group', { name: /bulk approve/i });
    await expect(bulkGroup).toBeVisible({ timeout: 5_000 });

    // Select All — exercises the real multi-row concurrent-approve path (the RQ v5 bug
    // was triggered by ≥2 concurrent mutate() calls on the same mutation instance;
    // commitBulk now uses mutateAsync + Promise.allSettled to avoid this).
    const selectAllCheck = bulkGroup.getByRole('checkbox', { name: /select all/i });
    await expect(selectAllCheck).toBeVisible({ timeout: 5_000 });
    await selectAllCheck.click();

    // ≥2 rows selected; "Approve N" (N≥2) button becomes enabled.
    const approveNBtn = bulkGroup.getByRole('button', { name: /^approve \d+$/i });
    await expect(approveNBtn).toBeVisible({ timeout: 5_000 });
    await expect(approveNBtn).toBeEnabled();

    // Capture N from the button label.
    const approveLabel = (await approveNBtn.textContent()) ?? '';
    const nMatch = approveLabel.match(/approve (\d+)/i);
    const n = nMatch ? parseInt(nMatch[1], 10) : 2;
    // Real multi-row journey: N must be ≥2.
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

    // Goal oracle (b): aggregate success toast appears confirming N approved.
    await expect(page.getByText(/timesheets? approved/i)).toBeVisible({ timeout: 15_000 });

    // Goal oracle (c) — reload-safe: navigate away and back to force a fresh server query —
    // approved weeks MUST NOT reappear (tests real server persistence, not optimistic UI).
    await page.goto('/');
    await page.goto('/approvals?scope=timesheets');

    // Wait for the section to re-render from fresh data.
    await expect(tsSection).toBeVisible({ timeout: 15_000 });

    // Wave5 BulkEng's week should no longer be in the awaiting queue.
    await expect(tsSection.getByText('Wave5 BulkEng')).not.toBeVisible({ timeout: 15_000 });
    // Cross-check: the inbox settled (not loading) — confirms the above is not a false
    // negative from a pending state masking the row.
    await expect(page.getByTestId('approvals-loading')).not.toBeVisible({ timeout: 5_000 });
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
