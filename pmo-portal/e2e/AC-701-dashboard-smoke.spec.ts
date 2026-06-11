import { test, expect } from '@playwright/test';
import { login } from './helpers';

// AC-701 (+ AC-709 org-scope) — real RPC over the real seed yields org-scoped KPIs in the real UI.
test('AC-701 Executive sees real org-scoped KPI values from the RPC', async ({ page }) => {
  await login(page, 'exec@acme.test');
  await page.goto('/');
  // P001 + P003 + P013 (Seabridge Terminal Delivery, added in plan D-5) = 3 Ongoing projects (see PR-#29 seed-resync precedent)
  await expect(page.getByTestId('kpi-active-projects')).toHaveText(/3/);
  // AC-PRJ-006 (runs before this in serial suite) sets P001 contract_value to 5,250,000;
  // P001 5,250,000 + P003 3,000,000 + P013 2,000,000 = 10,250,000
  await expect(page.getByTestId('kpi-total-contract-value')).toHaveText(/\$10,250,000/);
});
