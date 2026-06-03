import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('AC-402 My Projects shows PM-owned for Alice, empty for Dave', async ({ page }) => {
  await login(page, 'pm@acme.test');
  await page.goto('/projects');
  await page.getByRole('button', { name: /My Projects/ }).click();
  await expect(page.getByText('Innovate Corp HQ Fit-Out')).toBeVisible();

  // Sign out and sign in as engineer (Dave — no projects managed)
  await login(page, 'engineer@acme.test');
  await page.goto('/projects');
  await page.getByRole('button', { name: /My Projects/ }).click();
  await expect(page.getByText(/No projects found/i)).toBeVisible();
});
