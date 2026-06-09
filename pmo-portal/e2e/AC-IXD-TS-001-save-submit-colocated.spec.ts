import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

// AC-IXD-TS-001 (OWNER-VERBATIM journey · OD-UX-1 · plan tasks 13/14/15/16):
//
//   Given the timesheet entry screen,
//   Then the engineer sees Save AND Submit together from first paint
//     (Submit visible, disabled with "Enter hours to submit" until the week has
//      valid hours — OD-W3-1: Submit auto-saves, so it no longer requires a prior Save);
//   When she enters hours and clicks Save, the hours persist with a quiet
//     confirmation and NO forced summary view (she stays on the editable grid);
//   When she clicks Submit, the week becomes read-only Submitted.
//
// Convention-invariant: co-located primaries (Save + Submit in one footer zone),
// explicit post-states (Save → still editable; Submit → read-only Submitted).
//
// Seed-collision guard (binding): this journey signs in as a DEDICATED engineer
// (ts-colocated-eng@acme.test, profile b3 in seed.sql) that NO other spec touches.
// Previously it shared the engineer@ account with AC-TSE-021 — and both specs
// "step forward to the first empty week", so under the single-DB parallel suite
// they raced on the SAME (engineer@, first-empty-week) timesheet (one's save/submit
// clobbered the other → a nondeterministic-ordering flake). A dedicated engineer
// gives this journey its own per-week timesheet space, so it is ordering-independent.
// b3 has no seeded timesheet, so its current week is empty; the journey still steps
// FORWARD to a fresh week for fidelity (a brand-new, no-draft week).

test.setTimeout(120_000);

// DEDICATED engineer (no seeded timesheet) — see the seed-collision guard above.
const ENGINEER = 'ts-colocated-eng@acme.test';
const PROJECT_NAME = 'Acme Internal Platform';

/** Navigate forward week-by-week until the grid is empty (no rows) and editable. */
async function stepToEmptyWeek(page: Page, maxWeeks = 30): Promise<void> {
  for (let attempt = 0; attempt < maxWeeks; attempt++) {
    await expect(page.getByTestId('timesheets-loading')).not.toBeVisible({ timeout: 15_000 });
    const addProject = page.getByLabel('Add a project');
    const gridRow = page.locator('tbody tr').first();
    const addVisible = await addProject.isVisible().catch(() => false);
    const hasRows = await gridRow.isVisible().catch(() => false);
    if (addVisible && !hasRows) return;
    await page.getByRole('button', { name: /next week/i }).click();
    await page.waitForTimeout(400);
  }
  throw new Error('Could not find an empty editable week within the search window');
}

async function fillHourCell(page: Page, projectName: string, dayLabel: string, value: string): Promise<void> {
  const input = page.locator('tbody tr')
    .filter({ hasText: projectName })
    .getByRole('textbox', { name: new RegExp(`${projectName}, ${dayLabel} hours`, 'i') });
  await expect(input).toBeVisible({ timeout: 10_000 });
  await expect(input).toBeEnabled();
  await input.fill(value);
}

test('AC-IXD-TS-001 engineer saves (stays editable) then submits a week — Save + Submit co-located', async ({ page }) => {
  // ── Step 1: Sign in and navigate to a fresh empty editable week ─────────────
  await login(page, ENGINEER);
  await page.goto('/timesheets');
  await expect(page.getByTestId('timesheets-loading')).not.toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /next week/i }).click();
  await page.waitForTimeout(400);
  await stepToEmptyWeek(page);

  // ── Step 2: Save AND Submit are BOTH present from first paint, co-located ────
  // The footer is one action zone (Save secondary + Submit primary). On a brand-new
  // (no-hours) week Submit is rendered but DISABLED with "Enter hours to submit"
  // (OD-W3-1: Submit auto-saves valid hours, so the disabled state is about hours, not a prior Save).
  const footer = page.getByTestId('timesheets-footer');
  await expect(footer).toBeVisible({ timeout: 10_000 });
  const saveBtn = footer.getByRole('button', { name: /^save$/i });
  const submitBtn = footer.getByRole('button', { name: /submit timesheet/i });
  await expect(saveBtn).toBeVisible();
  await expect(submitBtn).toBeVisible();
  await expect(submitBtn).toBeDisabled();
  await expect(footer.getByText(/enter hours to submit/i)).toBeVisible();

  // ── Step 3: Enter hours on a project ────────────────────────────────────────
  await page.getByLabel('Add a project').selectOption({ label: PROJECT_NAME });
  await expect(page.locator('tbody tr').filter({ hasText: PROJECT_NAME })).toBeVisible({ timeout: 5_000 });
  await fillHourCell(page, PROJECT_NAME, 'Mon', '8');
  await expect(page.getByTestId('timesheets-weekly-total')).toContainText('8');

  // ── Step 4: Save → hours persist, QUIET toast, NO forced summary/view change ─
  await expect(saveBtn).toBeEnabled({ timeout: 5_000 });
  await saveBtn.click();
  await expect(page.getByText(/timesheet saved/i).first()).toBeVisible({ timeout: 15_000 });

  // Post-state: she STAYS on the editable grid (no view switch). The editable cell
  // is still an input; the weekly total reflects the persisted 8h; Draft pill shows.
  await expect(page.getByText('Draft — not submitted', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('tbody tr').filter({ hasText: PROJECT_NAME })
    .getByRole('textbox', { name: new RegExp(`${PROJECT_NAME}, Mon hours`, 'i') })).toBeVisible();
  await expect(page.getByTestId('timesheets-weekly-total')).toContainText('8');

  // AC-W3-N2: an Engineer (non-approver) has NO Approvals-queue toggle — they only ever see the
  // editable grid, so there is no alternate view to be navigated to (the "stayed editable" goal is
  // already proven by the persisted cell + total above). Confirm the Approvals toggle is absent.
  await expect(page.getByRole('tab', { name: /approvals queue/i })).toHaveCount(0);

  // ── Step 5: Submit is now ENABLED (a Draft with persisted hours exists) ──────
  await expect(submitBtn).toBeEnabled({ timeout: 10_000 });
  await submitBtn.click();

  // Submit is a consequential state-lock — if the app confirms, click through it.
  const confirmDialog = page.getByRole('dialog');
  if (await confirmDialog.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await confirmDialog.getByRole('button', { name: /submit timesheet/i }).click();
    await expect(confirmDialog).not.toBeVisible({ timeout: 15_000 });
  }

  // ── Step 6: Post-state — the week is read-only Submitted ─────────────────────
  await expect(page.getByText('Submitted', { exact: true })).toBeVisible({ timeout: 15_000 });
  // No editable hour inputs, no Add project, no Save, no Submit (read-only).
  await expect(page.locator('tbody input[type="text"]')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByLabel('Add a project')).not.toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole('button', { name: /^save$/i })).not.toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole('button', { name: /submit timesheet/i })).not.toBeVisible({ timeout: 5_000 });
});
