import { test, expect } from '@playwright/test';
import { login } from './helpers';

// ---------------------------------------------------------------------------
// AC-IXD-PROC-W5-3 — /approvals inbox: procurement row → decision screen
// AC-IXD-TS-W5-3  — /approvals inbox: timesheet bulk-approve persists
// AC-IXD-PROC-W5-3-role — role gating: Finance=procurement-only; Engineer=denied
//
// BDD authoring rule (CLAUDE.md §spec-conventions): each test encodes the user's
// REAL, INTUITIVE JOURNEY to the goal and asserts the GOAL/post-state.  The app
// conforms to the test; never weaken an assertion to match current app state.
//
// Seed assumptions (clean `npx supabase db reset`):
//   PROC-2026-002 (id …003): Requested, $22,500, requested_by = Dave Engineer
//     (engineer@acme.test / a4). pm@acme.test (Alice / a2) is an approver (PM role).
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
// When:  they see the procurement section and click the PROC-2026-002 row.
// Then:  the URL is /procurement/<id> and the Approve affordance is present on that
//        screen — the inbox row itself MUST NOT approve inline.
test(
  'AC-IXD-PROC-W5-3: PM inbox → procurement row opens decision screen where Approve lives',
  async ({ page }) => {
    await login(page, 'pm@acme.test');
    await page.goto('/approvals');

    // Procurement section is visible (PM role can approve procurement).
    const procSection = page.getByRole('region', { name: /purchase requests awaiting you/i });
    await expect(procSection).toBeVisible({ timeout: 15_000 });

    // PROC-2026-002 listed in the inbox.
    await expect(procSection.getByText('Safety Equipment & PPE')).toBeVisible({ timeout: 15_000 });
    await expect(procSection.getByText('PROC-2026-002')).toBeVisible({ timeout: 10_000 });

    // The row itself has NO inline Approve button — approve lives on the detail screen.
    await expect(procSection.getByRole('button', { name: /^approve$/i })).not.toBeVisible();

    // Click the row → navigate to the PR detail screen (Model B row-activation).
    await procSection.getByText('Safety Equipment & PPE').click();

    // Goal oracle 1: URL is the procurement detail page for this PR.
    await expect(page).toHaveURL(/\/procurement\/60000000-0000-0000-0000-000000000003/, { timeout: 10_000 });

    // Wait for the detail page to finish loading.
    await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute(
      'data-status',
      'Requested',
      { timeout: 10_000 },
    );

    // Goal oracle 2: Approve affordance is present on the decision screen (not on the inbox row).
    // It lives inside the decision-card section.
    const decisionCard = page.getByTestId('decision-card');
    await expect(decisionCard).toBeVisible({ timeout: 10_000 });
    await expect(decisionCard.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
  },
);

// ── AC-IXD-TS-W5-3 ──────────────────────────────────────────────────────────
// Given: a PM opens /approvals where Wave5 BulkEng's (b4) Submitted prior-week sheet
//        is already in the queue (pre-seeded; no UI-submit step).
// When:  pm@ (Alice) enters Select mode, selects all approvable rows, clicks "Approve N",
//        and confirms the dialog.
// Then:  a success toast confirms N approved AND Wave5 BulkEng's week is gone from the
//        queue after a fresh server re-fetch (reload-safe: not just optimistic UI).
//
// Isolation: b4 (Wave5 BulkEng) is a DEDICATED fixture — no auth.users row, never
// logs in. Its prior-week Submitted sheet is untouched by any other spec in the suite,
// so this test is ordering-independent with --workers=N or full sequential runs.
test(
  'AC-IXD-TS-W5-3: PM bulk-approves awaiting timesheets; approved weeks leave the queue (reload-safe)',
  async ({ page }) => {
    // Step 1: Alice (pm@) opens /approvals — Wave5 BulkEng's Submitted sheet should already
    // be in the queue (seeded as Submitted; no Dave→Submit pre-step needed).
    await login(page, 'pm@acme.test');
    // CW-6: a PM sees both modules as deep-linkable scope tabs; this test exercises the
    // timesheet queue, so it deep-links straight to that scope.
    await page.goto('/approvals?scope=timesheets');

    // Timesheet section visible.
    const tsSection = page.getByRole('region', { name: /timesheets awaiting you/i });
    await expect(tsSection).toBeVisible({ timeout: 15_000 });

    // Wave5 BulkEng's row is in the queue.
    await expect(tsSection.getByText('Wave5 BulkEng')).toBeVisible({ timeout: 15_000 });

    // Enter Select mode.
    await tsSection.getByRole('button', { name: /^select$/i }).click();

    // The bulk-action toolbar appears.
    const bulkGroup = page.getByRole('group', { name: /bulk approve/i });
    await expect(bulkGroup).toBeVisible({ timeout: 5_000 });

    // Select all approvable rows via the select-all checkbox.
    const selectAllCheck = bulkGroup.getByRole('checkbox', { name: /select all approvable weeks/i });
    await expect(selectAllCheck).toBeVisible();
    await selectAllCheck.click();

    // At least 1 row selected; "Approve N" button becomes enabled.
    const approveNBtn = bulkGroup.getByRole('button', { name: /^approve \d+$/i });
    await expect(approveNBtn).toBeVisible({ timeout: 5_000 });
    await expect(approveNBtn).toBeEnabled();

    // Capture N from the button label (e.g. "Approve 1").
    const approveLabel = (await approveNBtn.textContent()) ?? '';
    const nMatch = approveLabel.match(/approve (\d+)/i);
    const n = nMatch ? parseInt(nMatch[1], 10) : 1;

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

    // Dialog closes after mutation completes.
    await expect(bulkDialog).not.toBeVisible({ timeout: 20_000 });

    // Goal oracle 1: success toast appears confirming N approved.
    await expect(page.getByText(/timesheets? approved/i)).toBeVisible({ timeout: 15_000 });

    // Goal oracle 2 (reload-safe): navigate away and back to force a fresh server query —
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
