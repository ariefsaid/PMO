// @e2e-isolation: serial — temporarily adds options to the org-wide project setup lists and restores them.
import { test, expect } from '@playwright/test';
import { login, pickComboboxOption, openPipelineCard } from '../helpers';

test.setTimeout(120_000);
test('AC-TAG-002 classifications persist through form, detail editing, Projects and Pipeline filters', async ({ page }) => {
  const suffix = Date.now();
  const serviceLine = `Classification-${suffix}`;
  const sector = `Sector-${suffix}`;
  const deal = `Classification deal ${suffix}`;
  const internal = `Classification internal ${suffix}`;
  await login(page, 'admin@acme.test');
  await page.goto('/administration/projects');
  const lines = page.getByLabel('Service lines');
  const sectors = page.getByLabel('Sectors');
  await expect(lines).toBeVisible();
  const oldLines = await lines.inputValue();
  const oldSectors = await sectors.inputValue();
  const created: string[] = [];
  try {
    await lines.fill(`${oldLines}\n${serviceLine}`);
    await sectors.fill(`${oldSectors}\n${sector}`);
    await page.getByRole('button', { name: 'Save options' }).click();
    await expect(page.getByText('Classification options saved')).toBeVisible();
    for (const [name, stage] of [[deal, 'Leads'], [internal, 'Internal Project']] as const) {
      await page.goto('/projects');
      await page.getByRole('button', { name: /new project/i }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel(/Project name/).fill(name);
      await pickComboboxOption(dialog, page, /Client company/, 'first');
      await dialog.getByLabel('Origination stage').selectOption(stage);
      await expect(dialog.getByLabel('Service line')).toBeEnabled();
      await dialog.getByLabel('Service line').selectOption(serviceLine);
      await dialog.getByLabel('Sector').selectOption(sector);
      await dialog.getByLabel('Location').fill('West Java');
      await dialog.getByLabel('Award type').selectOption('tender');
      await dialog.getByLabel('Bidding entity').selectOption('consortium');
      await dialog.getByRole('button', { name: 'Create project' }).click();
      await expect(dialog).not.toBeVisible();
      created.push(name);
    }
    await page.goto('/sales?view=table');
    await page.getByLabel('Filter by service line').selectOption(serviceLine);
    await page.getByLabel('Filter by sector').selectOption(sector);
    await page.getByLabel('Filter by award type').selectOption('tender');
    await page.getByLabel('Filter by bidding entity').selectOption('consortium');
    await page.getByLabel('Filter by location').fill('West Java');
    await expect(page.getByText(deal, { exact: true })).toBeVisible();
    await openPipelineCard(page, deal);
    // Pre-win records have no rail: the classification list is a named region.
    const rail = page.getByRole('region', { name: 'Classification' });
    for (const value of [serviceLine, sector, 'West Java', 'Tender', 'Consortium']) await expect(rail.getByText(value, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /^Edit$/ }).click();
    const edit = page.getByRole('dialog');
    await edit.getByLabel('Location').fill('Bali');
    await edit.getByLabel('Award type').selectOption('direct');
    await edit.getByRole('button', { name: 'Save project' }).click();
    await expect(edit).not.toBeVisible();
    await page.reload();
    await expect(rail.getByText('Bali', { exact: true })).toBeVisible();
    await expect(rail.getByText('Direct award', { exact: true })).toBeVisible();
    await page.goto('/projects?view=table');
    await page.getByLabel('Filter by service line').last().selectOption(serviceLine);
    await expect(page.getByText(internal, { exact: true })).toBeVisible();
    await page.getByLabel('Filter by location').last().fill('Bali');
    await expect(page.getByText(internal, { exact: true })).toHaveCount(0);
  } finally {
    // Retiring the synthetic options preserves the rows' recorded classifications.
    await page.goto('/administration/projects');
    await page.getByLabel('Service lines').fill(oldLines);
    await page.getByLabel('Sectors').fill(oldSectors);
    await page.getByRole('button', { name: 'Save options' }).click();
    await expect(page.getByText('Classification options saved')).toBeVisible();
    for (const name of created) {
      await page.goto(name === deal ? '/sales?view=table' : '/projects?view=table');
      await page.getByText(name, { exact: true }).click();
      await page.getByRole('button', { name: /Archive/ }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: /archive project/i }).click();
      await expect(page.getByRole('alertdialog')).not.toBeVisible();
    }
  }
});
