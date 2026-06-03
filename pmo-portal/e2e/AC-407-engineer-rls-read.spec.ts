import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('AC-407 Engineer reads all org projects (RLS read path)', async ({ page }) => {
  await login(page, 'engineer@acme.test');
  await page.goto('/projects');
  await expect(page.getByText('Innovate Corp HQ Fit-Out')).toBeVisible();
  await expect(page.getByText('Northwind ERP Rollout')).toBeVisible();
  await expect(page.getByText('Regional Services Program')).toBeVisible();
});
