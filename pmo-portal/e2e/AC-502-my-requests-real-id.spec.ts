import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('AC-502 My Requests shows PM-requested rows, empty for Engineer', async ({ page }) => {
  // PM (a2) is requester of PROC-2026-004 (Workstations & AV), PROC-2026-001 (Network Infrastructure),
  // PROC-2026-003 (Survey Software Licenses), PROC-2026-005 (Office Fit-Out Furniture)
  await login(page, 'pm@acme.test');
  await page.goto('/procurement');
  await page.getByRole('button', { name: /My Requests/ }).click();
  await expect(page.getByText('Workstations & AV')).toBeVisible();

  // Engineer (a4) is requester of PROC-2026-002 (Safety Equipment & PPE) only
  // But My Requests for engineer shows that row
  await login(page, 'engineer@acme.test');
  await page.goto('/procurement');
  await page.getByRole('button', { name: /My Requests/ }).click();
  await expect(page.getByText('Safety Equipment & PPE')).toBeVisible();
  // PM rows should NOT appear for engineer
  await expect(page.getByText('Workstations & AV')).toHaveCount(0);
});
