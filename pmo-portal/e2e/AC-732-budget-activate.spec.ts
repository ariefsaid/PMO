import { test, expect } from '@playwright/test';
import { login } from './helpers';

// AC-732 — curated journey: PM creates a Draft, adds line-items {600000,400000}, activates,
// project shows formatCurrency(1000000).
// Uses P001 (40000000-0000-0000-0000-000000000001) which has an existing Active version.
// Creating a fresh Draft + activating it archives the prior Active and derives $1,000,000.
test('AC-732 PM creates a Draft, adds line-items {600000,400000}, activates, project shows formatCurrency(1000000)', async ({ page }) => {
  await login(page, 'pm@acme.test');

  // Navigate directly to P001's Budget tab
  await page.goto('/projects/40000000-0000-0000-0000-000000000001/budget');

  // Wait for the budget page to finish loading (not in loading skeleton)
  await expect(page.getByTestId('budget-loading')).not.toBeVisible({ timeout: 10_000 });

  // --- Step 1: Create a new Draft version ---
  await page.getByRole('button', { name: '+ New version' }).click();

  // Fill in version name
  const nameInput = page.getByPlaceholder('Version name (e.g. Budget v1)');
  await nameInput.fill('E2E Test Budget');
  await page.getByRole('button', { name: 'Create' }).click();

  // Wait for the new Draft version card to appear (it's the last/newest card)
  const draftCard = page.getByTestId('version-card').last();
  await expect(draftCard.getByTestId('version-status-draft')).toBeVisible({ timeout: 10_000 });
  await expect(draftCard).toContainText('E2E Test Budget');

  // --- Step 2: Add first line-item (600,000) ---
  await draftCard.getByRole('button', { name: '+ Add line item' }).click();

  // Fill amount for first item (Labor is default)
  await draftCard.getByPlaceholder('Amount').fill('600000');
  await draftCard.getByRole('button', { name: 'Save' }).click();

  // Wait for line-item row to appear (the cell in the table)
  await expect(draftCard.getByRole('cell', { name: '$600,000' })).toBeVisible({ timeout: 10_000 });

  // --- Step 3: Add second line-item (400,000) ---
  await draftCard.getByRole('button', { name: '+ Add line item' }).click();

  // Select Materials category for variety
  await draftCard.getByRole('combobox').selectOption('Materials');
  await draftCard.getByPlaceholder('Amount').fill('400000');
  await draftCard.getByRole('button', { name: 'Save' }).click();

  // Wait for second line-item to appear
  await expect(draftCard.getByRole('cell', { name: '$400,000' })).toBeVisible({ timeout: 10_000 });

  // --- Step 4: Activate the Draft version ---
  await draftCard.getByRole('button', { name: 'Activate' }).click();

  // --- Step 5: Assert the just-activated card shows Active status ---
  // After activation, the card at the same position now shows Active (it was updated in place)
  const activatedCard = page.getByTestId('version-card').filter({ hasText: 'E2E Test Budget' }).last();
  await expect(activatedCard.getByTestId('version-status-active')).toBeVisible({ timeout: 10_000 });

  // --- Step 6: Assert derived budget shows $1,000,000 ---
  await expect(page.getByTestId('derived-budget')).toHaveText('$1,000,000', { timeout: 10_000 });
});
