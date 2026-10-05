// @e2e-isolation: self-isolated — creates one uniquely named project and searches only its own row.
import { test, expect } from '@playwright/test';
import { login, pickComboboxOption } from './helpers';

test.setTimeout(90_000);

test('AC-CODE-003: PMO Project Number and Client Project Code are separately visible and either search opens the same project', async ({ page }) => {
  const runId = Date.now();
  const projectName = `E2E-Project-Identifiers-${runId}`;
  const clientCode = `CLIENT-${runId}`;

  await login(page, 'pm@acme.test');
  await page.goto('/projects');
  await expect(page.getByTestId('projects-loading')).not.toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /new project/i }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/project name/i).fill(projectName);
  await dialog.getByLabel(/origination stage/i).selectOption('Internal Project');
  await pickComboboxOption(dialog, page, /client company/i, 'first');

  const pmoNumberField = dialog.getByLabel('PMO Project Number');
  await expect(pmoNumberField).toHaveValue(/^PRJ-\d{2}-\d{4,}$/, { timeout: 15_000 });
  const pmoNumber = await pmoNumberField.inputValue();
  await dialog.getByLabel('Client Project Code').fill(clientCode);
  await dialog.getByRole('button', { name: /^Create project$/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 15_000 });

  await expect(page.getByRole('heading', { name: projectName })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('PMO Project Number', { exact: true }).locator('..')).toContainText(pmoNumber);
  await expect(page.getByText('Client Project Code', { exact: true }).locator('..')).toContainText(clientCode);

  const findProjectBy = async (value: string) => {
    await page.goto('/projects');
    await expect(page.getByTestId('projects-loading')).not.toBeVisible({ timeout: 20_000 });
    await page.getByRole('tab', { name: 'All', exact: true }).click();
    await page.getByRole('tab', { name: 'Table', exact: true }).click();
    const search = page.getByLabel('Search projects');
    await search.fill(value);
    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe(value);
    const row = page.locator('table tbody tr').filter({ hasText: projectName });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText(pmoNumber);
    await expect(row).toContainText(clientCode);
    await row.getByText(projectName, { exact: true }).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/i, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: projectName })).toBeVisible({ timeout: 15_000 });
    return page.url();
  };

  const numberRoute = await findProjectBy(pmoNumber);
  const clientCodeRoute = await findProjectBy(clientCode);
  expect(clientCodeRoute).toBe(numberRoute);
});
