// @e2e-isolation: self-isolated — dedicated engineer tse-021-eng@acme.test + own week; self-cleans.
import { test, expect, type Page } from '@playwright/test';
import { login, visibleToast, waitForFonts } from './helpers';

// AC-TSE-021 — Engineer logs, edits, deletes, and submits a timesheet week via the real stack.
//
// Journey (Given/When/Then per spec §5 AC-TSE-021, FR-TSE-001/003/006/008/011/012): Mobile 390×844 completion is the rendered oracle.
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
//
// ISOLATION FIX (Task 3c): uses dedicated engineer tse-021-eng@acme.test (seed profile c1)
// with its own per-week timesheet space, so it never collides with the shared
// engineer@acme.test or AC-IXD-TS-001's ts-colocated-eng@acme.test.

// Increase the per-test timeout: the journey has 9 steps with real DB round-trips.
test.setTimeout(120_000);

const ENGINEER = 'tse-021-eng@acme.test';
const PROJECT_NAME = 'Acme Internal Platform';

/** Navigate forward week-by-week until the grid is empty (no rows) and editable. */
async function stepToEmptyWeek(page: Page, maxWeeks = 26): Promise<void> {
  for (let attempt = 0; attempt < maxWeeks; attempt++) {
    // Wait for loading to finish.
    await expect(page.getByTestId('timesheets-loading')).not.toBeVisible({ timeout: 15_000 });

    const addProject = page.getByLabel('Add a project');
    const gridRow = page.locator('[data-testid^="tsgrid-row-total-"]').first();

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
  await expect(visibleToast(page, /timesheet saved/i)).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(300);
}

/**
 * Fill an hour cell in the editable grid. Re-locates the input on every call to
 * avoid stale-reference issues across React re-renders triggered by query refetches.
 */
async function fillHourCell(page: Page, projectName: string, dayLabel: string, value: string): Promise<void> {
  const input = page.getByRole('textbox', { name: new RegExp(`${projectName}, ${dayLabel} hours`, 'i') });
  await expect(input).toBeVisible({ timeout: 10_000 });
  await expect(input).toBeEnabled();
  await input.fill(value);
}

test('AC-TSE-021 engineer logs, edits, deletes, submits a week through the real stack', async ({ page }) => {

  // ── Step 1: Sign in as Engineer and navigate to Timesheets ──────────────────
  await login(page, ENGINEER);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/timesheets');
  await waitForFonts(page);

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
  await expect(page.getByText(PROJECT_NAME, { exact: true })).toBeVisible({ timeout: 5_000 });

  // ── Step 4: Enter hours across two projects ──────────────────────────────────
  await fillHourCell(page, PROJECT_NAME, 'Mon', '8');
  await fillHourCell(page, PROJECT_NAME, 'Tue', '6');
  await page.getByLabel('Add a project').selectOption({ label: 'Innovate Corp HQ Fit-Out' });
  await expect(page.getByText('Innovate Corp HQ Fit-Out', { exact: true })).toBeVisible({ timeout: 5_000 });
  await fillHourCell(page, 'Innovate Corp HQ Fit-Out', 'Wed', '4');

  // Live total should reflect 18h before saving across both projects.
  const weeklyTotalSpan = page.getByTestId('timesheets-weekly-total');
  await expect(weeklyTotalSpan).toContainText('18');

  // ── Step 5: Save — Draft is created on first Save (FR-TSE-011) ──────────────
  const saveBtn = page.getByRole('button', { name: /^save draft$/i });
  await expect(saveBtn).toBeEnabled({ timeout: 5_000 });
  await saveBtn.click();

  // Success toast confirms the write went through.
  await expectSaveToast(page);

  // Weekly total reflects persisted state: 18 hours across both projects.
  await expect(weeklyTotalSpan).toContainText('18');

  // The "Draft — not submitted" pill confirms a sheet now exists (FR-TSE-003 — created on Save).
  await expect(page.getByText('Draft — not submitted', { exact: true })).toBeVisible({ timeout: 10_000 });

  // ── Step 6: Edit — change Mon from 8 to 4, re-Save (FR-TSE-006/012) ─────────
  // After save + query refetch, re-locate the Monday input to avoid stale reference.
  await fillHourCell(page, PROJECT_NAME, 'Mon', '4');

  // Weekly total live-updates to 14 before saving.
  await expect(weeklyTotalSpan).toContainText('14');

  await saveBtn.click();
  await expectSaveToast(page);

  // Persisted weekly total = 14h across both projects.
  await expect(weeklyTotalSpan).toContainText('14');

  // ── Step 7: Delete the project row via the destructive ConfirmDialog ─────────
  // (FR-TSE-008 — mandatory ConfirmDialog before removing row)
  await page.getByRole('button', { name: new RegExp(`delete ${PROJECT_NAME} row`, 'i') }).click();

  // A destructive ConfirmDialog (alertdialog) must open before any row is removed.
  const alertDialog = page.getByRole('alertdialog');
  await expect(alertDialog).toBeVisible({ timeout: 5_000 });

  // The row is still present while the dialog is open — no write yet (FR-TSE-008).
  await expect(page.getByTestId('tsgrid-mobile').getByText(PROJECT_NAME, { exact: true })).toBeVisible();

  // Confirm the deletion.
  await alertDialog.getByRole('button', { name: /delete row/i }).click();

  // Dialog closes and row is gone (FR-TSE-008 — deletion round-trips to DB).
  await expect(alertDialog).not.toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(PROJECT_NAME, { exact: true })).not.toBeVisible({ timeout: 15_000 });

  // The other project's saved 4 hours remain after deleting this project row.
  await expect(weeklyTotalSpan).toContainText('4');

  // ── Step 8: Re-add, complete a two-project week, then Submit ────────────────
  // Wait for the query invalidation + refetch to settle before re-adding.
  // The picker becomes available again once editRows reflects the empty server state.
  await expect(page.getByLabel('Add a project')).toBeVisible({ timeout: 15_000 });

  // Re-add the project.
  await page.getByLabel('Add a project').selectOption({ label: PROJECT_NAME });

  // Wait for the new row to be stable before filling cells.
  await expect(page.getByText(PROJECT_NAME, { exact: true })).toBeVisible({ timeout: 5_000 });

  // Fill Monday, retain the other project's Tuesday hours, and submit without a Save-first step.
  await fillHourCell(page, PROJECT_NAME, 'Mon', '8');
  await expect(weeklyTotalSpan).toContainText('12');

  // Focus the last input as a phone keyboard would; both it and a validation error stay visible.
  await waitForFonts(page);
  const lastInput = page.getByRole('textbox', { name: /Innovate Corp HQ Fit-Out, Sun hours/i });
  await lastInput.fill('25');
  await expect(lastInput).toHaveAttribute('aria-invalid', 'true');
  const lastError = page.locator('[role="alert"]').filter({ hasText: '0–24 only' });
  await expect(lastError).toBeVisible();
  await lastInput.focus();
  await expect(lastInput).toBeFocused();

  // A reduced visual viewport stands in for the on-screen keyboard. Keep the whole final
  // field/error visible above the completion strip, with the existing invalid-input gate intact.
  await page.setViewportSize({ width: 390, height: 500 });
  await lastInput.scrollIntoViewIfNeeded();
  const strip = page.getByTestId('timesheets-mobile-action-strip');
  await expect(strip).toBeVisible();
  await expect(lastInput).toBeInViewport();
  await expect(lastError).toBeInViewport();
  const stripBox = await strip.boundingBox();
  const inputBox = await lastInput.boundingBox();
  const errorBox = await lastError.boundingBox();
  expect(stripBox).not.toBeNull();
  expect(inputBox).not.toBeNull();
  expect(errorBox).not.toBeNull();
  expect(inputBox!.y + inputBox!.height).toBeLessThanOrEqual(errorBox!.y);
  expect(errorBox!.y + errorBox!.height).toBeLessThanOrEqual(stripBox!.y);
  const submitBtn = page.getByRole('button', { name: 'Submit week' });
  await expect(submitBtn).toBeVisible();
  await expect(submitBtn).toBeDisabled(); // Invalid hours remain gated; the error is still visible.

  // Restore the full phone viewport and correct the invalid draft before submission.
  await page.setViewportSize({ width: 390, height: 844 });
  await lastInput.fill('0');
  await expect(lastInput).not.toHaveAttribute('aria-invalid', 'true');
  await expect(submitBtn).toBeEnabled();

  // Submit: mobile action opens the existing confirmation; dirty hours auto-save first.
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
  await expect(page.getByRole('textbox')).toHaveCount(0, { timeout: 10_000 });

  // No "Add project" picker (read-only = no write affordances).
  await expect(page.getByLabel('Add a project')).not.toBeVisible({ timeout: 5_000 });

  // Completion controls are removed after submission; the saved week remains visible.
  await expect(page.getByRole('button', { name: 'Save draft' })).not.toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole('button', { name: 'Submit week' })).not.toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('tsgrid-grand-total')).toContainText('12');
  const mobileGrid = page.getByTestId('tsgrid-mobile');
  await expect(mobileGrid.locator('[aria-label="Acme Internal Platform, Mon hours"]')).toHaveText('8');
  await expect(mobileGrid.locator('[aria-label="Innovate Corp HQ Fit-Out, Wed hours"]')).toHaveText('4');
});
