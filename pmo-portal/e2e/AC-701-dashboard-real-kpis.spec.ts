import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('AC-701/702 Executive sees real KPI values from seeded data', async ({ page }) => {
  await login(page, 'exec@acme.test');
  await page.goto('/');
  await expect(page.getByTestId('kpi-active-projects')).toHaveText(/2/);
  await expect(page.getByTestId('kpi-total-contract-value')).toHaveText(/\$8,000,000/);
  await expect(page.getByTestId('kpi-avg-gross-margin')).toHaveText(/30\.2%/);
  await expect(page.getByTestId('kpi-projects-at-risk')).toHaveText(/1/);
});
