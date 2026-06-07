import { test, expect } from '@playwright/test';
import { login } from './helpers';

// AC-911 — Submit → Approve happy path across two users (single curated journey).
// Owner (Dave/engineer@acme.test) submits their Draft week → sheet shows Submitted.
// Line manager (Alice/pm@acme.test) opens /approvals, approves → row leaves the queue.
//
// Seed fixture: Dave (a4, Engineer) has manager_id = Alice (a2, PM); both have Draft timesheets
// for week 2026-06-01 (Monday). The e2e performs the real Draft→Submitted RPC (not pre-seeded)
// then Submitted→Approved.
//
// NOTE (feat/ui-polish confirm-gate): BOTH the Submit and the Approve actions are now
// confirm-gated via ConfirmDialog:
//   • Submit: confirmLabel="Submit timesheet" (dialog role="dialog")
//   • Approve: confirmLabel="Approve" (dialog title "Approve Dave Engineer's week?")
// Strict-mode is avoided by scoping to role="dialog" before asserting the confirm button.
// The "not.toBeVisible" assertion on "Dave Engineer" is scoped to the approval row, not
// the full page, to avoid the dialog-title ambiguity.
//
// (FR-TS-001/004/005/008/011, NFR-TS-UI-001, plan Phase E3)

test('AC-911 submit→approve across two users: report submits Draft→Submitted, line manager approves Submitted→Approved', async ({ page }) => {

  // ── Step 1: Dave (owner) submits their Draft sheet ─────────────────────────
  await login(page, 'engineer@acme.test');
  await page.goto('/timesheets');

  // Wait for loading skeleton to disappear (timesheets data loaded).
  await expect(page.getByTestId('timesheets-loading')).not.toBeVisible({ timeout: 15_000 });

  // The seeded Draft sheet is for week 2026-06-01. The Submit button appears once:
  //   1. timesheets query resolved (isPending=false), AND
  //   2. currentUser profile resolved (isOwner = true).
  // Use a 20s timeout to cover the async profile load after data arrives.
  const submitBtn = page.getByRole('button', { name: /submit timesheet/i });
  await expect(submitBtn).toBeVisible({ timeout: 20_000 });
  await expect(submitBtn).toBeEnabled();

  // Click the page-level Submit button — stages a ConfirmDialog (no write yet).
  await submitBtn.click();

  // Confirm inside the dialog (confirmLabel="Submit timesheet"). Scope to role="dialog".
  const submitDialog = page.getByRole('dialog');
  await expect(submitDialog).toBeVisible({ timeout: 5_000 });
  const submitConfirmBtn = submitDialog.getByRole('button', { name: /submit timesheet/i });
  await expect(submitConfirmBtn).toBeVisible();
  await submitConfirmBtn.click();

  // Wait for the dialog to close (mutation committed, ConfirmDialog removed).
  await expect(submitDialog).not.toBeVisible({ timeout: 15_000 });

  // StatusPill shows exactly "Submitted" once the RPC resolves.
  // exact:true avoids matching "Draft — not submitted" or the toast "Timesheet submitted".
  await expect(page.getByText('Submitted', { exact: true })).toBeVisible({ timeout: 15_000 });

  // Submit button should no longer be present (status is Submitted, not Draft).
  await expect(page.getByRole('button', { name: /submit timesheet/i })).not.toBeVisible({ timeout: 5_000 });

  // ── Step 2: Alice (line manager) approves Dave's Submitted sheet ────────────
  await login(page, 'pm@acme.test');
  await page.goto('/approvals');

  // Wait for loading skeleton to disappear.
  await expect(page.getByTestId('approvals-loading')).not.toBeVisible({ timeout: 15_000 });

  // Dave's Submitted sheet should appear in Alice's approval queue.
  // Scope to the approval row section to avoid strict-mode issues with any dialog.
  const queue = page.locator('section');
  await expect(queue.getByText('Dave Engineer').first()).toBeVisible({ timeout: 10_000 });

  // Click Approve for Dave's row — stages a ConfirmDialog (no write yet).
  await page.getByRole('button', { name: /^approve$/i }).first().click();

  // Confirm inside the dialog (confirmLabel="Approve" per ApprovalsQueue.tsx).
  const approveDialog = page.getByRole('dialog');
  await expect(approveDialog).toBeVisible({ timeout: 5_000 });
  const approveConfirmBtn = approveDialog.getByRole('button', { name: /^approve$/i });
  await expect(approveConfirmBtn).toBeVisible();
  await approveConfirmBtn.click();

  // Wait for the dialog to close.
  await expect(approveDialog).not.toBeVisible({ timeout: 15_000 });

  // After approval, Dave's row should leave the queue (no matching row in the section).
  await expect(queue.getByText('Dave Engineer').first()).not.toBeVisible({ timeout: 15_000 });
});
