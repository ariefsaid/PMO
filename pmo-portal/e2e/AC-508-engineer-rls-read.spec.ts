import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('AC-508 Engineer reads org procurements (RLS read path)', async ({ page }) => {
  await login(page, 'engineer@acme.test');
  await page.goto('/procurement');
  await page.getByRole('button', { name: /^All/ }).click();
  // All 5 seeded rows are in the org — engineer should see them all via RLS
  await expect(page.getByText('Workstations & AV')).toBeVisible();
  await expect(page.getByText('Network Infrastructure')).toBeVisible();
  await expect(page.getByText('Safety Equipment & PPE')).toBeVisible();
});
