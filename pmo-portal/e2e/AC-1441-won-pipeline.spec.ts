// @e2e-isolation: read-only — reads a seeded on-hand project and navigates its canonical detail route.
import { test, expect } from '@playwright/test';
import { login, openPipelineCard } from './helpers';

test('AC-1441: a won bid is reachable from the Pipeline Won column and opens its canonical project page', async ({ page }) => {
  await login(page, 'exec@acme.test');
  await page.goto('/sales');

  const board = page.getByLabel('Sales pipeline board');
  await expect(board).toBeVisible({ timeout: 15_000 });
  const wonColumn = page.getByTestId('stage-Won');
  const wonProject = 'Innovate Corp HQ Fit-Out';
  await expect(wonColumn.getByText(wonProject).first()).toBeVisible({ timeout: 15_000 });
  await openPipelineCard(page, wonProject, wonColumn);
  await expect(page).toHaveURL(/\/projects\/40000000-0000-0000-0000-000000000001$/u);
  await expect(page.getByRole('heading', { name: wonProject })).toBeVisible({ timeout: 15_000 });
});
