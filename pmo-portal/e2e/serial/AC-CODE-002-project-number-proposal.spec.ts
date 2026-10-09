// @e2e-isolation: serial — this journey changes the organisation-wide project-number pattern and restores it in finally.
import { test, expect } from '@playwright/test';
import { login, pickComboboxOption, visibleToast } from '../helpers';

test.setTimeout(120_000);

test('AC-CODE-001 + AC-CODE-002: Admin saves a client-segment pattern and a PM creates a project with an editable unique number', async ({ page }) => {
  const runId = Date.now();
  const companyName = `E2E-Number-Client-${runId}`;
  const projectName = `E2E-Number-Project-${runId}`;
  const clientSegment = `SEG${runId}`;
  const chosenNumber = `MANUAL-${runId}`;
  const clientCode = `CLIENT-${runId}`;
  const customPattern = `E2E-{CLIENT}-{YY}-{SEQ4}`;

  await login(page, 'admin@acme.test');
  await page.goto('/administration/accounting');
  await expect(page.getByTestId('administration-panel-accounting')).toBeVisible();
  const patternInput = page.getByRole('textbox', { name: 'Project number pattern' });
  await expect(patternInput).toBeVisible({ timeout: 15_000 });
  const originalPattern = await patternInput.inputValue();

  try {
    await patternInput.fill(customPattern);
    const savePattern = page.getByRole('button', { name: 'Save pattern' });
    await expect(savePattern).toBeEnabled();
    await savePattern.click();
    await expect(visibleToast(page, 'Project number pattern updated')).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Project number pattern' })).toHaveValue(customPattern, { timeout: 15_000 });

    // Create an expendable Client row; no seeded company or project is changed.
    await page.goto('/companies');
    await expect(page.getByTestId('liststate-loading')).toHaveCount(0, { timeout: 20_000 });
    await page.getByRole('button', { name: /new company/i }).click();
    const companyDialog = page.getByRole('dialog');
    await companyDialog.getByLabel(/company name/i).fill(companyName);
    await companyDialog.locator('select').first().selectOption('Client');
    await companyDialog.getByRole('button', { name: /create company/i }).click();
    await expect(companyDialog).not.toBeVisible({ timeout: 15_000 });

    const companyRow = page.locator('table tbody tr').filter({
      has: page.getByRole('button', { name: `Open ${companyName}`, exact: true }),
    });
    await expect(companyRow).toBeVisible({ timeout: 15_000 });
    await companyRow.getByRole('button', { name: `Open ${companyName}`, exact: true }).click();
    await expect(page).toHaveURL(/\/companies\/[0-9a-f-]+$/i, { timeout: 15_000 });
    await page.getByTestId('company-edit').click();
    const editCompanyDialog = page.getByRole('dialog');
    await editCompanyDialog.getByLabel(/client number segment/i).fill(clientSegment);
    await editCompanyDialog.getByRole('button', { name: /save company/i }).click();
    await expect(editCompanyDialog).not.toBeVisible({ timeout: 15_000 });

    await login(page, 'pm@acme.test');
    await page.goto('/projects');
    await expect(page.getByTestId('projects-loading')).not.toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: /new project/i }).click();
    const projectDialog = page.getByRole('dialog');
    await projectDialog.getByLabel(/project name/i).fill(projectName);
    await projectDialog.getByLabel(/origination stage/i).selectOption('Internal Project');
    await pickComboboxOption(projectDialog, page, /client company/i, new RegExp(companyName));

    const pmoNumber = projectDialog.getByLabel('PMO Project Number');
    await expect(pmoNumber).toHaveValue(new RegExp(`^E2E-${clientSegment}-\\d{2}-\\d{4,}$`), { timeout: 15_000 });
    // The Admin-defined token pattern is expanded, while the proposed value remains editable.
    await pmoNumber.fill(chosenNumber);
    await projectDialog.getByLabel('Client Project Code').fill(clientCode);
    await projectDialog.getByRole('button', { name: /^Create project$/i }).click();
    await expect(projectDialog).not.toBeVisible({ timeout: 15_000 });

    await expect(page.getByRole('heading', { name: projectName })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('PMO Project Number', { exact: true }).locator('..')).toContainText(chosenNumber);
    await expect(page.getByText('Client Project Code', { exact: true }).locator('..')).toContainText(clientCode);
  } finally {
    // The org-wide setting is shared by every test; always restore its original effective value.
    await login(page, 'admin@acme.test');
    await page.goto('/administration/accounting');
    await expect(page.getByTestId('administration-panel-accounting')).toBeVisible();
    const restoreInput = page.getByRole('textbox', { name: 'Project number pattern' });
    await expect(restoreInput).toBeVisible({ timeout: 15_000 });
    const currentPattern = await restoreInput.inputValue();
    if (currentPattern !== originalPattern) {
      await restoreInput.fill(originalPattern);
      const restoreButton = page.getByRole('button', { name: 'Save pattern' });
      await expect(restoreButton).toBeEnabled();
      await restoreButton.click();
      await expect(visibleToast(page, 'Project number pattern updated')).toBeVisible({ timeout: 15_000 });
      await page.reload();
    }
    await expect(page.getByRole('textbox', { name: 'Project number pattern' })).toHaveValue(originalPattern, { timeout: 15_000 });
  }
});
