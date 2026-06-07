import { test, expect } from '@playwright/test';
import { login } from './helpers';

// AC-732 — curated journey: PM creates a Draft, adds line-items {600000,400000}, activates,
// project shows formatCurrency(1000000).
// Uses P001 (40000000-0000-0000-0000-000000000001) which has an existing Active version.
// Creating a fresh Draft + activating it archives the prior Active and derives $1,000,000.
//
// NOTE (feat/ui-polish confirm-gate):
//   • Clicking "Create" in the NewVersionForm now STAGES a ConfirmDialog with
//     confirmLabel="Create version". Must click that confirm before the version exists.
//   • ProjectBudget now renders ONE VersionCard at a time via a version <select>
//     (aria-label="Version"). After creating the new version, wait for the option to
//     appear in the select, then select it to see its card.
//   • "Activate" also stages a ConfirmDialog (confirmLabel="Activate version").
test('AC-732 PM creates a Draft, adds line-items {600000,400000}, activates, project shows formatCurrency(1000000)', async ({ page }) => {
  await login(page, 'pm@acme.test');

  // Navigate directly to P001's Budget tab
  await page.goto('/projects/40000000-0000-0000-0000-000000000001/budget');

  // Wait for the budget page to finish loading (not in loading skeleton)
  await expect(page.getByTestId('budget-loading')).not.toBeVisible({ timeout: 10_000 });

  // --- Step 1: Create a new Draft version (confirm-gated) ---
  await page.getByRole('button', { name: '+ New version' }).click();

  // Fill in version name
  const nameInput = page.getByPlaceholder('Version name (e.g. Budget v1)');
  await nameInput.fill('E2E Test Budget');
  // Click "Create" — this STAGES a ConfirmDialog (no single-click write)
  await page.getByRole('button', { name: 'Create' }).click();

  // Confirm inside the dialog (confirmLabel="Create version" per confirmCopy.create)
  const createDialog = page.getByRole('dialog');
  await expect(createDialog).toBeVisible({ timeout: 5_000 });
  const createConfirmBtn = createDialog.getByRole('button', { name: 'Create version', exact: true });
  await expect(createConfirmBtn).toBeVisible();
  await createConfirmBtn.click();

  // Wait for the dialog to close (mutation committed)
  await expect(createDialog).not.toBeVisible({ timeout: 10_000 });

  // --- Step 2: SELECT the new version in the version dropdown ---
  // ProjectBudget renders ONE card at a time; the newly created Draft may not be
  // auto-selected if an Active version exists. Wait for the option to appear in the
  // select (React Query refetch after mutation), then select it by its value (UUID).
  const versionSelect = page.getByLabel('Version');
  await expect(versionSelect).toBeVisible({ timeout: 10_000 });

  // Wait for the "E2E Test Budget (Draft)" option to appear in the select.
  await expect(page.locator('option', { hasText: /E2E Test Budget.*Draft/ })).toBeAttached({ timeout: 10_000 });

  // Evaluate the select to find the option value for "E2E Test Budget (Draft)"
  const draftOptionValue = await page.evaluate(() => {
    const sel = document.getElementById('budget-version-select') as HTMLSelectElement | null;
    if (!sel) return null;
    for (const opt of Array.from(sel.options)) {
      if (opt.text.includes('E2E Test Budget') && opt.text.includes('Draft')) {
        return opt.value;
      }
    }
    return null;
  });
  expect(draftOptionValue, 'Draft version option not found in select').not.toBeNull();
  await versionSelect.selectOption(draftOptionValue!);

  // The version card for the newly selected Draft should now be visible
  const draftCard = page.getByTestId('version-card');
  await expect(draftCard.getByTestId('version-status-draft')).toBeVisible({ timeout: 10_000 });
  await expect(draftCard).toContainText('E2E Test Budget');

  // --- Step 3: Add first line-item (600,000) ---
  await draftCard.getByRole('button', { name: '+ Add line item' }).click();

  // Fill amount for first item (Labor is default)
  await draftCard.getByPlaceholder('Amount').fill('600000');
  await draftCard.getByRole('button', { name: 'Save' }).click();

  // Wait for line-item row to appear (the cell in the table)
  await expect(draftCard.getByRole('cell', { name: '$600,000' })).toBeVisible({ timeout: 10_000 });

  // --- Step 4: Add second line-item (400,000) ---
  await draftCard.getByRole('button', { name: '+ Add line item' }).click();

  // Select Materials category for variety
  await draftCard.getByRole('combobox').selectOption('Materials');
  await draftCard.getByPlaceholder('Amount').fill('400000');
  await draftCard.getByRole('button', { name: 'Save' }).click();

  // Wait for second line-item to appear
  await expect(draftCard.getByRole('cell', { name: '$400,000' })).toBeVisible({ timeout: 10_000 });

  // --- Step 5: Activate the Draft version (confirm-gated) ---
  await draftCard.getByRole('button', { name: 'Activate' }).click();

  // Confirm inside the dialog (confirmLabel="Activate version" per confirmCopy.activate)
  const activateDialog = page.getByRole('dialog');
  await expect(activateDialog).toBeVisible({ timeout: 5_000 });
  const activateConfirmBtn = activateDialog.getByRole('button', { name: 'Activate version', exact: true });
  await expect(activateConfirmBtn).toBeVisible();
  await activateConfirmBtn.click();

  // Wait for the dialog to close
  await expect(activateDialog).not.toBeVisible({ timeout: 10_000 });

  // --- Step 6: Assert the now-active card shows Active status ---
  // After activation the selector auto-selects the newly active version.
  // The visible card (single-card view) now shows Active status.
  const activatedCard = page.getByTestId('version-card').filter({ hasText: 'E2E Test Budget' });
  await expect(activatedCard.getByTestId('version-status-active')).toBeVisible({ timeout: 10_000 });

  // --- Step 7: Assert derived budget shows $1,000,000 ---
  await expect(page.getByTestId('derived-budget')).toHaveText('$1,000,000', { timeout: 10_000 });
});
