// @e2e-isolation: serial — mutates org-global state (see design 2026-07-11-e2e-parallel-isolation).
import { test, expect, type Route } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { login, waitForFonts } from '../helpers';

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
test('AC-732 PM creates a Draft, adds line-items {600000,400000}, a second person activates, project shows formatCurrency(1000000)', async ({ page }, testInfo) => {
  // This curated journey spans fifteen captures and three real user sessions; its retained trace
  // exceeded Playwright's 30-second default before the Engineer oracle failed.
  test.setTimeout(120_000);

  const captureDir = testInfo.outputPath(`1472-authoring-ui-captures-${Date.now()}`);
  mkdirSync(captureDir, { recursive: true });
  const capture = async (name: string) => {
    await waitForFonts(page);
    const file = path.join(captureDir, `${name}.png`);
    const metrics = await page.evaluate(() => {
      const grid = document.querySelector<HTMLElement>('[data-testid="budget-distribution-grid"]');
      const scroller = grid?.querySelector<HTMLElement>('.overflow-x-auto');
      const active = document.activeElement;
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        gridViewportWidth: scroller?.clientWidth ?? null,
        gridContentWidth: scroller?.scrollWidth ?? null,
        gridScrollLeft: scroller?.scrollLeft ?? null,
        activeControl: active instanceof HTMLElement
          ? active.getAttribute('aria-label') ?? active.getAttribute('name') ?? active.tagName
          : null,
        invalidFieldCount: grid?.querySelectorAll('[aria-invalid="true"]').length ?? 0,
      };
    });
    await page.screenshot({ path: file, fullPage: true });
    appendFileSync(path.join(captureDir, 'manifest.jsonl'), `${JSON.stringify({
      name,
      file: path.basename(file),
      metrics,
      stateSources: {
        sourceLines: 'budget-draft-persisted-via-authoring-flow',
        fiscalYears: 'controlled-activation-precheck',
        adapterWrite: 'controlled-success-response',
      },
    })}\n`);
    return metrics;
  };
  const chooseTheme = async (theme: 'light' | 'dark', locale: 'en' | 'id' = 'en') => {
    const account = page.getByRole('button', { name: locale === 'id' ? 'Menu akun' : 'Account menu', exact: true });
    await account.click();
    const label = theme === 'dark' ? (locale === 'id' ? 'Gelap' : 'Dark') : (locale === 'id' ? 'Terang' : 'Light');
    await page.getByRole('menuitemradio', { name: label, exact: true }).click();
    await expect.poll(() => page.locator('html').evaluate((element) => element.classList.contains('dark')))
      .toBe(theme === 'dark');
    await account.click();
  };
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
  await expect(draftEditor.locator('tbody').getByRole('cell', { name: '$600,000', exact: true })).toBeVisible({ timeout: 10_000 });

  // --- Step 4: Add second line-item (400,000) ---
  await draftEditor.getByRole('button', { name: '+ Add line item', exact: true }).click();

  // Select Materials category for variety
  await draftEditor.getByLabel('Line item category').selectOption('Materials');
  await draftEditor.getByPlaceholder('Amount').fill('400000');
  await draftEditor.getByRole('button', { name: 'Save' }).click();

  // Wait for second line-item to appear
  await expect(draftEditor.locator('tbody').getByRole('cell', { name: '$400,000', exact: true })).toBeVisible({ timeout: 10_000 });

  // Whole-project Drafts need an explicit saved distribution before an eligible approver can
  // review them. The source lines come from the seeded project; the adapter precheck below supplies
  // a clearly controlled fiscal-year response so this journey never performs a live ERP write.
  const distribution = draftEditor.getByTestId('budget-distribution-grid');
  await distribution.getByRole('button', { name: 'Preview distribution', exact: true }).click();
  await distribution.getByRole('status').filter({ hasText: 'Preview ready' }).waitFor({ state: 'visible' });
  await expect(distribution).toContainText('$600,000');
  await expect(distribution).toContainText('$400,000');
  await expect(distribution.locator('tfoot')).toContainText('$1,000,000');

  // Capture the real, reconciled preview across the desktop/phone, light/dark and EN/ID matrix.
  // These are actual UI screenshots of persisted budget-draft rows and the labeled controlled calendar.
  await page.setViewportSize({ width: 1440, height: 900 });
  await chooseTheme('light');
  await capture('preview-en-desktop-light');
  await chooseTheme('dark');
  await capture('preview-en-desktop-dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await chooseTheme('light');
  const selector = distribution.getByRole('combobox', { name: 'Distribution method' });
  await selector.focus();
  const focusedPhone = await capture('preview-en-phone-light-selector-focus');
  expect(focusedPhone.activeControl).toBe('Distribution method');
  expect(focusedPhone.gridContentWidth ?? 0).toBeGreaterThan(focusedPhone.gridViewportWidth ?? 0);
  expect(focusedPhone.documentWidth).toBeLessThanOrEqual(focusedPhone.viewportWidth + 1);
  await distribution.locator('.overflow-x-auto').evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  await capture('preview-en-phone-light-grid-scrolled');
  await distribution.locator('.overflow-x-auto').evaluate((element) => {
    element.scrollLeft = 0;
  });
  await chooseTheme('dark');
  await capture('preview-en-phone-dark');
  await page.setViewportSize({ width: 1440, height: 900 });
  await chooseTheme('light');

  await distribution.getByRole('button', { name: 'Save reviewed distribution', exact: true }).click();
  const distributionDialog = page.getByRole('dialog', { name: 'Save this distribution?' });
  await distributionDialog.getByRole('button', { name: 'Save distribution', exact: true }).click();
  await expect(distribution.getByText('Saved distribution', { exact: true })).toBeVisible({ timeout: 10_000 });
  await capture('saved-en-desktop-light');

  // The mode-conversion review remains a user-controlled confirmation and can be canceled safely.
  await draftEditor.getByRole('button', { name: 'Change budget mode', exact: true }).click();
  const modeDialog = page.getByRole('dialog', { name: 'Change budget mode' });
  await expect(modeDialog).toBeVisible();
  await expect(modeDialog.getByRole('combobox', { name: 'Fiscal year for Labor' })).toBeVisible();
  await modeDialog.getByRole('combobox', { name: 'Fiscal year for Labor' }).selectOption('2026');
  await modeDialog.getByRole('combobox', { name: 'Fiscal year for Materials' }).selectOption('2026');
  await capture('mode-conversion-en-desktop-light');
  await modeDialog.getByRole('button', { name: 'Cancel', exact: true }).click();

  // Category override preview proves the inherited total remains exact while one category uses a custom allocation.
  await distribution.getByRole('combobox', { name: 'Distribution method' }).selectOption('percent_by_year');
  await distribution.getByRole('textbox', { name: 'Shared input for 2026' }).fill('100');
  await distribution.getByRole('checkbox', { name: 'Use custom distribution for Materials' }).check();
  await distribution.getByRole('textbox', { name: 'Materials input for 2026' }).fill('100');
  await distribution.getByRole('button', { name: 'Preview distribution', exact: true }).click();
  await expect(distribution.getByRole('status').filter({ hasText: 'Preview ready' })).toBeVisible();
  await expect(distribution.locator('tfoot')).toContainText('$1,000,000');
  await capture('override-preview-en-desktop-light');

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
  await capture('stale-real-source-edit-en-desktop-light');
  await laborRow.getByRole('button', { name: 'Edit line item Labor', exact: true }).click();
  await refreshedEditor.getByRole('textbox', { name: 'Amount', exact: true }).fill('600000');
  await laborRow.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(refreshedDistribution.getByText('Saved distribution', { exact: true })).toBeVisible({ timeout: 10_000 });

  // Controlled read failure is labeled as such in the evidence manifest; retry reads the real saved plan again.
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
  await capture('controlled-query-error-en-desktop-light');
  await page.unroute('**/rest/v1/rpc/get_budget_distribution_snapshot*', failSnapshotRead);
  await errorDistribution.getByRole('button', { name: 'Retry saved distribution read', exact: true }).click();
  await expect(errorDistribution.getByText('Saved distribution', { exact: true })).toBeVisible({ timeout: 10_000 });

  // --- Step 5: the drafter cannot activate their own version (OD-BUDGET-6) ---
  await expect(draftBanner.getByRole('button', { name: 'Activate' })).toHaveCount(0);
  // copy corrected: drafter or editor (#1405)
  await expect(draftBanner.getByRole('status')).toHaveText(
    'You drafted or edited this version, so someone else must activate it.',
  );

  // An Engineer's budget deep link falls back to the Project Overview before ProjectBudget mounts.
  await login(page, 'engineer@acme.test');
  await page.goto('/projects/40000000-0000-0000-0000-000000000001/budget');
  const overviewTab = page.getByRole('tab', { name: 'Overview', exact: true });
  await expect(overviewTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Budget', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('budget-option-a')).toHaveCount(0);
  await expect(page.getByTestId('budget-empty')).toHaveCount(0);
  await expect(page.getByTestId('budget-distribution-grid')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Draft budget editor' })).toHaveCount(0);
  await capture('engineer-route-fallback-en-desktop-light');

  // Save Bahasa through the supported profile preference flow, then render the same real saved preview.
  await login(page, 'pm@acme.test');
  await page.goto('/settings/profile');
  await page.getByLabel('Interface language', { exact: true }).selectOption('id');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Profil & preferensi', exact: true })).toBeVisible({ timeout: 10_000 });
  await page.goto('/projects/40000000-0000-0000-0000-000000000001/budget');
  await expect(page.getByTestId('budget-loading')).not.toBeVisible({ timeout: 10_000 });
  const bahasaDraftBanner = page.getByRole('region', { name: 'Draf menunggu persetujuan' });
  await expect(bahasaDraftBanner).toBeVisible();
  await bahasaDraftBanner.getByRole('button', { name: 'Ubah draf', exact: true }).click();
  const bahasaEditor = page.getByRole('region', { name: 'Editor anggaran draf' });
  const bahasaDistribution = bahasaEditor.getByTestId('budget-distribution-grid');
  await bahasaDistribution.getByRole('button', { name: 'Pratinjau alokasi', exact: true }).click();
  await expect(bahasaDistribution.getByRole('status').filter({ hasText: 'Pratinjau siap' })).toBeVisible();
  await expect(bahasaDistribution.locator('tfoot')).toContainText('US$1.000.000,00');
  await page.setViewportSize({ width: 1440, height: 900 });
  await chooseTheme('light', 'id');
  await capture('preview-id-desktop-light');
  await chooseTheme('dark', 'id');
  await capture('preview-id-desktop-dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await chooseTheme('light', 'id');
  await capture('preview-id-phone-light');
  await chooseTheme('dark', 'id');
  await capture('preview-id-phone-dark');
  await page.setViewportSize({ width: 1440, height: 900 });
  await chooseTheme('light', 'id');

  // The shipped server fence keeps whole-project activation unavailable until S45. Complete the
  // explicit user-reviewed conversion after the whole-project captures so AC-732 remains a real
  // per-year activation and the deployment fence stays intact.
  await bahasaEditor.getByRole('button', { name: 'Ubah mode anggaran', exact: true }).click();
  const activationModeDialog = page.getByRole('dialog', { name: 'Ubah mode anggaran' });
  await activationModeDialog.getByRole('combobox').nth(0).selectOption('2026');
  await activationModeDialog.getByRole('combobox').nth(1).selectOption('2026');
  await activationModeDialog.getByRole('button', { name: 'Ubah ke per tahun', exact: true }).click();
  await expect(activationModeDialog).not.toBeVisible({ timeout: 10_000 });
  await expect(bahasaEditor.getByTestId('budget-distribution-grid')).toHaveCount(0);

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
