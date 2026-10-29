// @e2e-isolation: serial — mutates org-global state (see design 2026-07-11-e2e-parallel-isolation).
import { test, expect } from '@playwright/test';
import { login } from '../helpers';

// AC-732 — curated journey: PM creates a Draft, adds line-items {600000,400000}, a second person
// (Finance) activates it, project shows formatCurrency(1000000).
// OD-BUDGET-6 (#922): the drafter cannot activate their own version — the PM sees why instead of an
// Activate button, and a second eligible user activates. The goal oracle is unchanged.
// Uses P001 (40000000-0000-0000-0000-000000000001) which has an existing Active version.
// Creating a fresh Draft + activating it archives the prior Active and derives $1,000,000.
//
// NOTE (feat/ui-polish confirm-gate):
//   • Clicking "Create" in the NewVersionForm now STAGES a ConfirmDialog with
//     confirmLabel="Create version". Must click that confirm before the version exists.
//   • The created Draft appears in the Draft waiting for approval banner; its Edit draft action
//     opens the line-item editor.
//   • "Activate" also stages a ConfirmDialog (confirmLabel="Activate version").
test('AC-732 PM creates a Draft, adds line-items {600000,400000}, a second person activates, project shows formatCurrency(1000000)', async ({ page }) => {
  // This journey owns the PMO activation + derived-value contract, not the live ERPNext boundary.
  // Keep the push consequence deterministic so a served, absent, or recently torn-down edge runtime
  // cannot turn the confirm dialog into an environment-dependent timeout.
  await page.route('**/functions/v1/adapter-dispatch', async (route) => {
    const body = route.request().postDataJSON() as {
      action?: string;
      domain?: string;
      operation?: string;
      record?: { id?: string; [key: string]: unknown };
    };

    if (body.action === 'budget-activation-precheck') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ready',
          erpCheck: 'available',
          fiscalYearNames: ['2026', '2027'],
          issues: [],
        }),
      });
      return;
    }

    if (body.domain !== 'budget' || body.operation !== 'create') {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        externalRecordId: `Budget/${body.record?.id}`,
        canonical: body.record,
      }),
    });
  });

  await login(page, 'pm@acme.test');

  // Navigate directly to P001's Budget tab
  await page.goto('/projects/40000000-0000-0000-0000-000000000001/budget');

  // Wait for the budget page to finish loading (not in loading skeleton)
  await expect(page.getByTestId('budget-loading')).not.toBeVisible({ timeout: 10_000 });

  // --- Step 1: Create a new Draft version (confirm-gated) ---
  await page.getByRole('button', { name: 'New version', exact: true }).click();

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

  // --- Step 2: open the newly created Draft from its current banner action ---
  const draftBanner = page.getByRole('region', { name: 'Draft waiting for approval' });
  await expect(draftBanner).toBeVisible({ timeout: 10_000 });
  await expect(draftBanner.getByText('Draft', { exact: true })).toBeVisible();
  await expect(draftBanner).toContainText('E2E Test Budget');
  await draftBanner.getByRole('button', { name: 'Edit draft', exact: true }).click();
  const draftEditor = page.getByRole('region', { name: 'Draft budget editor' });
  await expect(draftEditor).toBeVisible();

  // --- Step 3: Add first line-item (600,000) ---
  await draftEditor.getByRole('button', { name: '+ Add line item', exact: true }).click();

  // Fill amount for first item (Labor is default)
  await draftEditor.getByPlaceholder('Amount').fill('600000');
  await draftEditor.getByRole('button', { name: 'Save' }).click();

  // Wait for line-item row to appear (the cell in the table)
  await expect(draftEditor.locator('tbody').getByRole('cell', { name: '$600,000' })).toBeVisible({ timeout: 10_000 });

  // --- Step 4: Add second line-item (400,000) ---
  await draftEditor.getByRole('button', { name: '+ Add line item', exact: true }).click();

  // Select Materials category for variety
  await draftEditor.getByLabel('Line item category').selectOption('Materials');
  await draftEditor.getByPlaceholder('Amount').fill('400000');
  await draftEditor.getByRole('button', { name: 'Save' }).click();

  // Wait for second line-item to appear
  await expect(draftEditor.locator('tbody').getByRole('cell', { name: '$400,000' })).toBeVisible({ timeout: 10_000 });

  // --- Step 5: the drafter cannot activate their own version (OD-BUDGET-6) ---
  await expect(draftBanner.getByRole('button', { name: 'Activate' })).toHaveCount(0);
  // copy corrected: drafter or editor (#1405)
  await expect(draftBanner.getByRole('status')).toHaveText(
    'You drafted or edited this version, so someone else must activate it.',
  );

  // --- Step 6: a second person (Finance) opens the same Draft and activates it (confirm-gated) ---
  await login(page, 'finance@acme.test');
  await page.goto('/projects/40000000-0000-0000-0000-000000000001/budget');
  await expect(page.getByTestId('budget-loading')).not.toBeVisible({ timeout: 10_000 });
  const financeBanner = page.getByRole('region', { name: 'Draft waiting for approval' });
  await expect(financeBanner).toBeVisible({ timeout: 10_000 });
  await expect(financeBanner.getByText('Draft', { exact: true })).toBeVisible();
  await expect(financeBanner).toContainText('E2E Test Budget');
  await financeBanner.getByRole('button', { name: /^Activate v\d+$/ }).click();

  // Confirm inside the dialog (confirmLabel="Activate version" per confirmCopy.activate)
  const activateDialog = page.getByRole('dialog');
  await expect(activateDialog).toBeVisible({ timeout: 5_000 });
  const activateConfirmBtn = activateDialog.getByRole('button', { name: 'Activate version', exact: true });
  await expect(activateConfirmBtn).toBeVisible();

  // The adapter endpoint also handles the readiness precheck. Wait for the budget-create
  // request specifically so that preparatory calls cannot satisfy the push-body oracle.
  const budgetPushRequest = page.waitForRequest((request) => {
    if (request.method() !== 'POST' || !request.url().includes('/adapter-dispatch')) return false;
    const body = request.postDataJSON() as { domain?: string; operation?: string };
    return body.domain === 'budget' && body.operation === 'create';
  });
  await activateConfirmBtn.click();

  const pushBody = (await budgetPushRequest).postDataJSON() as {
    domain?: string;
    operation?: string;
    record?: { id?: string; [key: string]: unknown };
  };
  expect(pushBody.domain).toBe('budget');
  expect(pushBody.operation).toBe('create');
  expect(pushBody.record?.id).toBeTruthy();

  // Wait for the dialog to close
  await expect(activateDialog).not.toBeVisible({ timeout: 10_000 });

  // --- Step 7: Assert the now-active card shows Active status ---
  // After activation the selector auto-selects the newly active version.
  // The visible card (single-card view) now shows Active status.
  const activatedVersion = page.getByRole('region', { name: 'Budget versions' })
    .getByRole('row').filter({ hasText: 'E2E Test Budget' });
  await expect(activatedVersion.getByRole('cell', { name: 'Active', exact: true })).toBeVisible({ timeout: 10_000 });

  // --- Step 8: Assert derived budget shows $1,000,000 ---
  const budgetFigure = page.getByRole('region', { name: 'Budget figures' })
    .getByText('Budget', { exact: true }).locator('xpath=../..');
  await expect(budgetFigure).toBeVisible({ timeout: 10_000 });
  await expect(budgetFigure.locator('[title]')).toHaveAttribute('title', '$1,000,000');
});
