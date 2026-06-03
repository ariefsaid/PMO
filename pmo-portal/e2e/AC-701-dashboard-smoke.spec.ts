import { test, expect } from '@playwright/test';
import { login } from './helpers';

// AC-701 (+ AC-709 org-scope) — real RPC over the real seed yields org-scoped KPIs in the real UI.
test('AC-701 Executive sees real org-scoped KPI values from the RPC', async ({ page }) => {
  await login(page, 'exec@acme.test');
  await page.goto('/');
  await expect(page.getByTestId('kpi-active-projects')).toHaveText(/2/); // org-scoped via security-invoker RPC (AC-709)
  await expect(page.getByTestId('kpi-total-contract-value')).toHaveText(/\$8,000,000/);
});
