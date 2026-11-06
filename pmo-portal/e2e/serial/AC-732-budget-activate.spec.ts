// @e2e-isolation: serial — mutates org-global state (see design 2026-07-11-e2e-parallel-isolation).
import { test, expect, type Page, type Route } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { login, requireServiceRoleKey } from '../helpers';

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

// Split (#1960): one ~110-action journey ran at 90% of the 30 s timeout. No request took over 0.4 s;
// the time was ~17 page loads, each paying the dev server's cold module fetch. Journey 1 owns
// create -> activate -> $1,000,000; journey 2 owns whole-project distribution authoring; journey 3 the Engineer fallback.
// Both are PMO-only: the live ERPNext boundary is stubbed so the confirm dialog stays deterministic.
const P001 = '40000000-0000-0000-0000-000000000001';

async function mockAdapter(page: Page) {
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
          fiscalYears: [
            { name: '2026', start: '2026-01-01', end: '2026-12-31' },
            { name: '2027', start: '2027-01-01', end: '2027-12-31' },
          ],
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
}

async function createDraftWithLines(page: Page, name: string) {
  await mockAdapter(page);
  await login(page, 'pm@acme.test');
  await page.goto('/projects/40000000-0000-0000-0000-000000000001/budget');
  await expect(page.getByTestId('budget-loading')).not.toBeVisible({ timeout: 10_000 });

  // --- Step 1: Create a new Draft version (confirm-gated) ---
  await page.getByRole('button', { name: 'New version', exact: true }).click();

  // Fill in version name
  const nameInput = page.getByPlaceholder('Version name (e.g. Budget v1)');
  await nameInput.fill(name);
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
  await expect(draftBanner).toContainText(name);
  await draftBanner.getByRole('button', { name: 'Edit draft', exact: true }).click();
  const draftEditor = page.getByRole('region', { name: 'Draft budget editor' });
  await expect(draftEditor).toBeVisible();

  // --- Step 3: Add first line-item (600,000) ---
  await draftEditor.getByRole('button', { name: '+ Add line item', exact: true }).click();

  // Fill amount for first item (Labor is default)
  await draftEditor.getByPlaceholder('Amount').fill('600000');
  await draftEditor.getByRole('button', { name: 'Save' }).click();

  // Wait for line-item row to appear (the cell in the table)
  await expect(draftEditor.locator('tbody').getByRole('cell', { name: '$600,000', exact: true })).toBeVisible({ timeout: 10_000 });

  // --- Step 4: Add second line-item (400,000) ---
  await draftEditor.getByRole('button', { name: '+ Add line item', exact: true }).click();

  // Select Materials category for variety
  await draftEditor.getByLabel('Line item category').selectOption('Materials');
  await draftEditor.getByPlaceholder('Amount').fill('400000');
  await draftEditor.getByRole('button', { name: 'Save' }).click();

  // Wait for second line-item to appear
  await expect(draftEditor.locator('tbody').getByRole('cell', { name: '$400,000', exact: true })).toBeVisible({ timeout: 10_000 });

  return { draftBanner, draftEditor };
}

// P001 has one Draft slot. A prior run that died mid-journey (or journey 2, which never activates)
// leaves its Draft behind and hides "New version", so each journey starts and ends with none of ours.
async function removeE2eDrafts() {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-732 cleanup needs the service role key');
  const admin = createClient(process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '', key, { auth: { persistSession: false } });
  const drafts = await admin.from('budget_versions').select('id')
    .eq('project_id', P001).eq('status', 'Draft').like('name', 'E2E %').throwOnError();
  for (const { id } of drafts.data ?? []) {
    await admin.from('budget_line_items').delete().eq('budget_version_id', id).throwOnError();
    await admin.from('budget_versions').delete().eq('id', id).throwOnError();
  }
}

test.beforeEach(removeE2eDrafts);
test.afterEach(removeE2eDrafts);

test('AC-732 PM creates a Draft, adds line-items {600000,400000}, a second person activates, project shows formatCurrency(1000000)', async ({ page }) => {
  const { draftEditor } = await createDraftWithLines(page, 'E2E Test Budget');

  // Whole-project Drafts need an explicit saved distribution before an eligible approver can
  // review them. The source lines come from the seeded project; the adapter precheck below supplies
  // a clearly controlled fiscal-year response so this journey never performs a live ERP write.
  const distribution = draftEditor.getByTestId('budget-distribution-grid');
  await distribution.getByRole('button', { name: 'Preview distribution', exact: true }).click();
  await distribution.getByRole('status').filter({ hasText: 'Preview ready' }).waitFor({ state: 'visible' });
  await expect(distribution).toContainText('$600,000');
  await expect(distribution).toContainText('$400,000');
  await expect(distribution.locator('tfoot')).toContainText('$1,000,000');

  await distribution.getByRole('button', { name: 'Save reviewed distribution', exact: true }).click();
  const distributionDialog = page.getByRole('dialog', { name: 'Save this distribution?' });
  await distributionDialog.getByRole('button', { name: 'Save distribution', exact: true }).click();
  await expect(distribution.getByText('Saved distribution', { exact: true })).toBeVisible({ timeout: 10_000 });

  // The shipped server fence keeps whole-project activation unavailable until S45. Complete the
  // explicit user-reviewed conversion so AC-732 stays a real per-year activation and the
  // deployment fence stays intact.
  await draftEditor.getByRole('button', { name: 'Change budget mode', exact: true }).click();
  const activationModeDialog = page.getByRole('dialog', { name: 'Change budget mode' });
  await activationModeDialog.getByRole('combobox', { name: 'Fiscal year for Labor' }).selectOption('2026');
  await activationModeDialog.getByRole('combobox', { name: 'Fiscal year for Materials' }).selectOption('2026');
  await activationModeDialog.getByRole('button', { name: 'Switch to per-year', exact: true }).click();
  await expect(activationModeDialog).not.toBeVisible({ timeout: 10_000 });
  await expect(draftEditor.getByTestId('budget-distribution-grid')).toHaveCount(0);

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

test('AC-732 whole-project Draft authoring: distribution saves, goes stale on a source edit, recovers from a read failure; the drafter cannot activate', async ({ page }) => {
  const { draftBanner, draftEditor } = await createDraftWithLines(page, 'E2E Authoring Budget');

  // Whole-project Drafts need an explicit saved distribution before an eligible approver can
  // review them. The source lines come from the seeded project; the adapter precheck below supplies
  // a clearly controlled fiscal-year response so this journey never performs a live ERP write.
  const distribution = draftEditor.getByTestId('budget-distribution-grid');
  await distribution.getByRole('button', { name: 'Preview distribution', exact: true }).click();
  await distribution.getByRole('status').filter({ hasText: 'Preview ready' }).waitFor({ state: 'visible' });
  await expect(distribution).toContainText('$600,000');
  await expect(distribution).toContainText('$400,000');
  await expect(distribution.locator('tfoot')).toContainText('$1,000,000');

  await distribution.getByRole('button', { name: 'Save reviewed distribution', exact: true }).click();
  const distributionDialog = page.getByRole('dialog', { name: 'Save this distribution?' });
  await distributionDialog.getByRole('button', { name: 'Save distribution', exact: true }).click();
  await expect(distribution.getByText('Saved distribution', { exact: true })).toBeVisible({ timeout: 10_000 });

  // The mode-conversion review remains a user-controlled confirmation and can be canceled safely.
  await draftEditor.getByRole('button', { name: 'Change budget mode', exact: true }).click();
  const modeDialog = page.getByRole('dialog', { name: 'Change budget mode' });
  await expect(modeDialog).toBeVisible();
  await expect(modeDialog.getByRole('combobox', { name: 'Fiscal year for Labor' })).toBeVisible();
  await modeDialog.getByRole('combobox', { name: 'Fiscal year for Labor' }).selectOption('2026');
  await modeDialog.getByRole('combobox', { name: 'Fiscal year for Materials' }).selectOption('2026');
  await modeDialog.getByRole('button', { name: 'Cancel', exact: true }).click();

  // Category override preview proves the inherited total remains exact while one category uses a custom allocation.
  await distribution.getByRole('combobox', { name: 'Distribution method' }).selectOption('percent_by_year');
  await distribution.getByRole('textbox', { name: 'Shared input for 2026' }).fill('100');
  await distribution.getByRole('checkbox', { name: 'Use custom distribution for Materials' }).check();
  await distribution.getByRole('textbox', { name: 'Materials input for 2026' }).fill('100');
  await distribution.getByRole('button', { name: 'Preview distribution', exact: true }).click();
  await expect(distribution.getByRole('status').filter({ hasText: 'Preview ready' })).toBeVisible();
  await expect(distribution.locator('tfoot')).toContainText('$1,000,000');

  // Close/reopen to reload only persisted by-days inputs before the stale and error scenarios.
  await draftEditor.getByRole('button', { name: 'Close', exact: true }).click();
  await draftBanner.getByRole('button', { name: 'Edit draft', exact: true }).click();
  const refreshedEditor = page.getByRole('region', { name: 'Draft budget editor' });
  const refreshedDistribution = refreshedEditor.getByTestId('budget-distribution-grid');
  await expect(refreshedDistribution.getByText('Saved distribution', { exact: true })).toBeVisible();

  // A real source edit makes the persisted distribution stale; reverting the exact source amount restores it.
  const laborRow = refreshedEditor.locator('tbody tr').filter({ hasText: 'Labor' }).first();
  await laborRow.getByRole('button', { name: 'Edit line item Labor', exact: true }).click();
  await refreshedEditor.getByRole('textbox', { name: 'Amount', exact: true }).fill('600001');
  await laborRow.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(refreshedDistribution.getByText('Saved distribution needs review', { exact: true })).toBeVisible({ timeout: 10_000 });
  await laborRow.getByRole('button', { name: 'Edit line item Labor', exact: true }).click();
  await refreshedEditor.getByRole('textbox', { name: 'Amount', exact: true }).fill('600000');
  await laborRow.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(refreshedDistribution.getByText('Saved distribution', { exact: true })).toBeVisible({ timeout: 10_000 });

  // Controlled read failure; retry reads the real saved plan again.
  const failSnapshotRead = async (route: Route) => route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ code: 'XX000', message: 'controlled authoring proof read failure' }),
  });
  await page.route('**/rest/v1/rpc/get_budget_distribution_snapshot*', failSnapshotRead);
  await page.reload();
  await expect(page.getByTestId('budget-loading')).not.toBeVisible({ timeout: 10_000 });
  const retryDraftBanner = page.getByRole('region', { name: 'Draft waiting for approval' });
  await retryDraftBanner.getByRole('button', { name: 'Edit draft', exact: true }).click();
  const errorEditor = page.getByRole('region', { name: 'Draft budget editor' });
  const errorDistribution = errorEditor.getByTestId('budget-distribution-grid');
  await expect(errorDistribution.getByRole('alert')).toContainText("Couldn't load the saved distribution");
  await page.unroute('**/rest/v1/rpc/get_budget_distribution_snapshot*', failSnapshotRead);
  await errorDistribution.getByRole('button', { name: 'Retry saved distribution read', exact: true }).click();
  await expect(errorDistribution.getByText('Saved distribution', { exact: true })).toBeVisible({ timeout: 10_000 });

  // --- Step 5: the drafter cannot activate their own version (OD-BUDGET-6) ---
  await expect(draftBanner.getByRole('button', { name: 'Activate' })).toHaveCount(0);
  // copy corrected: drafter or editor (#1405)
  await expect(draftBanner.getByRole('status')).toHaveText(
    'You drafted or edited this version, so someone else must activate it.',
  );
});

test('AC-732 an Engineer\'s budget deep link falls back to the Project Overview', async ({ page }) => {
  await login(page, 'engineer@acme.test');
  // An Engineer's budget deep link falls back to the Project Overview before ProjectBudget mounts.
  await page.goto('/projects/40000000-0000-0000-0000-000000000001/budget');
  const overviewTab = page.getByRole('tab', { name: 'Overview', exact: true });
  await expect(overviewTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Budget', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('budget-option-a')).toHaveCount(0);
  await expect(page.getByTestId('budget-empty')).toHaveCount(0);
  await expect(page.getByTestId('budget-distribution-grid')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Draft budget editor' })).toHaveCount(0);
});
