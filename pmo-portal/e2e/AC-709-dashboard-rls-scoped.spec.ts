import { test, expect } from '@playwright/test';
import { login } from './helpers';

// AC-709: admin@acme.test falls to the Executive default branch (real role = 'Admin').
// The RPC (security invoker) returns org-scoped aggregates — asserting active_projects = 2
// proves the org isolation, not cross-org leakage.
test('AC-709 Admin (falls to Exec branch) sees org-scoped KPIs via invoker RPC', async ({ page }) => {
  await login(page, 'admin@acme.test');
  await page.goto('/');
  await expect(page.getByTestId('kpi-active-projects')).toHaveText(/2/);
});
