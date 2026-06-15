import { test, expect } from '@playwright/test';
import { login } from './helpers';

// AC-701 (+ AC-709 org-scope) — real RPC over the real seed yields org-scoped KPIs in the real UI.
test('AC-701 Executive sees real org-scoped KPI values from the RPC', async ({ page }) => {
  await login(page, 'exec@acme.test');
  await page.goto('/');
  // SP-2401 + SP-2402 + P001 + P003 + P013 = 5 Ongoing projects (rich solar seed, PR-#118 resync)
  await expect(page.getByTestId('kpi-active-projects')).toHaveText(/5/);
  // SP-2401 5,250,000 + SP-2402 7,800,000 + P001 5,000,000 + P003 3,000,000 + P013 2,000,000 = 23,050,000
  await expect(page.getByTestId('kpi-total-contract-value')).toHaveText(/\$23,050,000/);
});
