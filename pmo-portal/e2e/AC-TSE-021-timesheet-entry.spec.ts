import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

// AC-TSE-021 — Engineer logs, edits, deletes, and submits a timesheet week via the real stack.
//
// Journey (Given/When/Then per spec §5 AC-TSE-021, FR-TSE-001/003/006/008/011/012):
//   Given a signed-in Engineer on a week with NO existing timesheet,
//   When they add "Acme Internal Platform" (P003, Ongoing Project), enter 8h Mon + 6h Tue, Save
//     → Draft is created on first Save; totals reflect the persisted state.
//   When they change Mon to 4 and Save again
//     → edit round-trips through the DB; weekly total is 10h.
//   When they delete the row via the destructive ConfirmDialog
//     → row is gone; total 0.0h.
//   When they re-add + enter 8h Mon, Save, then Submit
//     → grid is read-only (no spinbutton inputs, no Add project, no Save).
//
// Seed-collision guard (binding): AC-911 operates on the seeded 2026-06-01 Draft sheet.
// This journey steps FORWARD from today until it finds an empty editable grid, then
// builds fresh on "Acme Internal Platform" (not present in the seeded 2026-06-01 week).

// Increase the per-test timeout: the journey has 9 steps with real DB round-trips.
test.setTimeout(120_000);

const ENGINEER = 'engineer@acme.test';
const PROJECT_NAME = 'Acme Internal Platform';

/** Navigate forward week-by-week until the grid is empty (no rows) and editable. */
async function stepToEmptyWeek(page: Page, maxWeeks = 26): Promise<void> {
  for (let attempt = 0; attempt < maxWeeks; attempt++) {
    // Wait for loading to finish.
    await expect(page.getByTestId('timesheets-loading')).not.toBeVisible({ timeout: 15_000 });

    const addProject = page.getByLabel('Add a project');
    const gridRow = page.locator('tbody tr').first();

    const addVisible = await addProject.isVisible().catch(() => false);
    const hasRows = await gridRow.isVisible().catch(() => false);

    if (addVisible && !hasRows) {
      // Found an empty editable week.
      return;
    }
    // Either read-only, or editable with rows — step forward.
    await page.getByRole('button', { name: /next week/i }).click();
    await page.waitForTimeout(400); // let the week-nav re-render settle
  }
  throw new Error('Could not find an empty editable week within the search window');
}

/** Wait for a success toast. Use .first() to handle multiple stacked toasts. */
async function expectSaveToast(page: Page): Promise<void> {
  await expect(page.getByText(/timesheet saved/i).first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(300);
}

/**
 * Fill an hour cell in the editable grid. Re-locates the input on every call to
 * avoid stale-reference issues across React re-renders triggered by query refetches.
 */
async function fillHourCell(page: Page, projectName: string, dayLabel: string, value: string): Promise<void> {
  const input = page.locator('tbody tr')
    .filter({ hasText: projectName })
    .getByRole('textbox', { name: new RegExp(`${projectName}, ${dayLabel} hours`, 'i') });
  await expect(input).toBeVisible({ timeout: 10_000 });
  await expect(input).toBeEnabled();
  await input.fill(value);
}

test('AC-TSE-021 engineer logs, edits, deletes, submits a week through the real stack', async ({ page }) => {

  // ── Step 1: Sign in as Engineer and navigate to Timesheets ──────────────────
  await login(page, ENGINEER);
  await page.goto('/timesheets');

  // Wait for the loading skeleton to resolve.
  await expect(page.getByTestId('timesheets-loading')).not.toBeVisible({ timeout: 15_000 });

  // ── Step 2: Navigate forward to an empty, editable week ─────────────────────
  // Click Next week once to leave the seeded 2026-06-01 week (owned by AC-911),
  // then keep stepping until we find an empty editable grid.
  await page.getByRole('button', { name: /next week/i }).click();
  await page.waitForTimeout(400);

  await stepToEmptyWeek(page);

  // Verify the "Add a project" picker is present (editable empty state).
  await expect(page.getByLabel('Add a project')).toBeVisible({ timeout: 10_000 });

  // ── Step 3: Add project "Acme Internal Platform" ────────────────────────────
  await page.getByLabel('Add a project').selectOption({ label: PROJECT_NAME });

  // A new editable row should appear for Acme Internal Platform.
  await expect(page.locator('tbody tr').filter({ hasText: PROJECT_NAME })).toBeVisible({ timeout: 5_000 });

  // ── Step 4: Enter hours — 8h Monday, 6h Tuesday ─────────────────────────────
  // The aria-label pattern is "<project>, <weekday> hours" (NFR-TSE-A11Y-001).
  await fillHourCell(page, PROJECT_NAME, 'Mon', '8');
  await fillHourCell(page, PROJECT_NAME, 'Tue', '6');

  // Live total should reflect 14h before saving (FR-TSE-013 — totals track edits live).
  const weeklyTotalSpan = page.getByTestId('timesheets-weekly-total');
  await expect(weeklyTotalSpan).toContainText('14');

  // ── Step 5: Save — Draft is created on first Save (FR-TSE-011) ──────────────
  const saveBtn = page.getByRole('button', { name: /^save$/i });
  await expect(saveBtn).toBeEnabled({ timeout: 5_000 });
  await saveBtn.click();

  // Success toast confirms the write went through.
  await expectSaveToast(page);

  // Weekly total reflects persisted state: 14.0 h this week.
  await expect(weeklyTotalSpan).toContainText('14');

  // The "Draft — not submitted" pill confirms a sheet now exists (FR-TSE-003 — created on Save).
  await expect(page.getByText('Draft — not submitted', { exact: true })).toBeVisible({ timeout: 10_000 });

  // ── Step 6: Edit — change Mon from 8 to 4, re-Save (FR-TSE-006/012) ─────────
  // After save + query refetch, re-locate the Monday input to avoid stale reference.
  await fillHourCell(page, PROJECT_NAME, 'Mon', '4');

  // Weekly total live-updates to 10 before saving.
  await expect(weeklyTotalSpan).toContainText('10');

  await saveBtn.click();
  await expectSaveToast(page);

  // Persisted weekly total = 10.0 h this week (Mon=4 + Tue=6).
  await expect(weeklyTotalSpan).toContainText('10');

  // ── Step 7: Delete the project row via the destructive ConfirmDialog ─────────
  // (FR-TSE-008 — mandatory ConfirmDialog before removing row)
  await page.locator('tbody tr')
    .filter({ hasText: PROJECT_NAME })
    .getByRole('button', { name: new RegExp(`delete ${PROJECT_NAME} row`, 'i') })
    .click();

  // A destructive ConfirmDialog (alertdialog) must open before any row is removed.
  const alertDialog = page.getByRole('alertdialog');
  await expect(alertDialog).toBeVisible({ timeout: 5_000 });

  // The row is still present while the dialog is open — no write yet (FR-TSE-008).
  await expect(page.locator('tbody tr').filter({ hasText: PROJECT_NAME })).toBeVisible();

  // Confirm the deletion.
  await alertDialog.getByRole('button', { name: /delete row/i }).click();

  // Dialog closes and row is gone (FR-TSE-008 — deletion round-trips to DB).
  await expect(alertDialog).not.toBeVisible({ timeout: 10_000 });
  await expect(page.locator('tbody tr').filter({ hasText: PROJECT_NAME })).not.toBeVisible({ timeout: 15_000 });

  // Weekly total resets to 0.0 h (all entries deleted).
  await expect(weeklyTotalSpan).toContainText('0.0');

  // ── Step 8: Re-add, enter 8h Mon, Save, then Submit ─────────────────────────
  // Wait for the query invalidation + refetch to settle before re-adding.
  // The picker becomes available again once editRows reflects the empty server state.
  await expect(page.getByLabel('Add a project')).toBeVisible({ timeout: 15_000 });

  // Re-add the project.
  await page.getByLabel('Add a project').selectOption({ label: PROJECT_NAME });

  // Wait for the new row to be stable before filling cells.
  await expect(page.locator('tbody tr').filter({ hasText: PROJECT_NAME })).toBeVisible({ timeout: 5_000 });

  // Fill Mon hour using the fresh-locator helper.
  await fillHourCell(page, PROJECT_NAME, 'Mon', '8');
  await expect(weeklyTotalSpan).toContainText('8');

  // Save.
  await saveBtn.click();
  await expectSaveToast(page);
  await expect(weeklyTotalSpan).toContainText('8');

  // Submit: click "Submit timesheet" → confirm dialog → confirm.
  const submitBtn = page.getByRole('button', { name: /submit timesheet/i });
  await expect(submitBtn).toBeVisible({ timeout: 10_000 });
  await submitBtn.click();

  // Submit ConfirmDialog opens (role="dialog" because tone="default").
  const submitDialog = page.getByRole('dialog');
  await expect(submitDialog).toBeVisible({ timeout: 5_000 });
  await submitDialog.getByRole('button', { name: /submit timesheet/i }).click();

  // Dialog closes.
  await expect(submitDialog).not.toBeVisible({ timeout: 15_000 });

  // ── Step 9: Assert post-submit: grid is read-only (FR-TSE-002) ──────────────
  // "Submitted" pill appears.
  await expect(page.getByText('Submitted', { exact: true })).toBeVisible({ timeout: 15_000 });

  // No editable hour inputs: the TimesheetGrid is now in read-only mode
  // (cells render as <div> elements, not <input> elements).
  await expect(page.locator('tbody input[type="text"]')).toHaveCount(0, { timeout: 10_000 });

  // No "Add project" picker (read-only = no write affordances).
  await expect(page.getByLabel('Add a project')).not.toBeVisible({ timeout: 5_000 });

  // No Save button.
  await expect(page.getByRole('button', { name: /^save$/i })).not.toBeVisible({ timeout: 5_000 });

  // Submit button also gone (already Submitted).
  await expect(page.getByRole('button', { name: /submit timesheet/i })).not.toBeVisible({ timeout: 5_000 });
});
