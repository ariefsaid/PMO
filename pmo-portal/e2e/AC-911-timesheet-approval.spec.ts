import { test, expect } from '@playwright/test';
import { login } from './helpers';

// AC-911 — Submit → Approve happy path across two users (single curated journey).
// Owner (Dave/engineer@acme.test) submits their Draft week → sheet shows Submitted.
// Line manager (Alice/pm@acme.test) opens /approvals, approves → row leaves the queue.
//
// Seed fixture: Dave (a4, Engineer) has manager_id = Alice (a2, PM); both have Draft timesheets
// for week 2026-06-01 (today = 2026-06-05 Friday → same Monday week). The e2e performs the
// real Draft→Submitted RPC (not pre-seeded) then Submitted→Approved.
//
// (FR-TS-001/004/005/008/011, NFR-TS-UI-001, plan Phase E3)

test('AC-911 submit→approve across two users: report submits Draft→Submitted, line manager approves Submitted→Approved', async ({ page }) => {

  // ── Step 1: Dave (owner) submits their Draft sheet ─────────────────────────
  await login(page, 'engineer@acme.test');
  await page.goto('/timesheets');

  // Wait for loading skeleton to disappear.
  await expect(page.getByTestId('timesheets-loading')).not.toBeVisible({ timeout: 15_000 });

  // Today is 2026-06-05 (Friday), so the current week start is 2026-06-01 (Monday) —
  // the same week as Dave's seeded Draft timesheet. No week navigation needed.
  // Confirm the Submit button is visible (Draft sheet owned by the signed-in user).
  const submitBtn = page.getByRole('button', { name: /submit timesheet/i });
  await expect(submitBtn).toBeVisible({ timeout: 10_000 });
  await expect(submitBtn).toBeEnabled();

  await submitBtn.click();

  // After RPC resolves the status badge should show Submitted.
  await expect(page.getByTestId('timesheets-loading')).not.toBeVisible({ timeout: 15_000 });
  // The TimesheetStatusBadge is rendered inside the weekly header alongside the title.
  await expect(page.getByText('Submitted')).toBeVisible({ timeout: 15_000 });

  // Submit button should no longer be present (status is no longer Draft).
  await expect(submitBtn).not.toBeVisible({ timeout: 5_000 });

  // ── Step 2: Alice (line manager) approves Dave's Submitted sheet ────────────
  await login(page, 'pm@acme.test');
  await page.goto('/approvals');

  // Wait for loading skeleton to disappear.
  await expect(page.getByTestId('approvals-loading')).not.toBeVisible({ timeout: 15_000 });

  // Dave's Submitted sheet should appear in Alice's approval queue.
  // The Approvals page renders `sheet.owner?.full_name` — seed has "Dave Engineer".
  await expect(page.getByText('Dave Engineer')).toBeVisible({ timeout: 10_000 });

  // Click Approve for Dave's row.
  await page.getByRole('button', { name: /approve/i }).first().click();

  // After approval, Dave's row should leave the queue.
  // Either the queue goes empty (approvals-empty) or the row is no longer visible.
  await expect(page.getByText('Dave Engineer')).not.toBeVisible({ timeout: 15_000 });
});
