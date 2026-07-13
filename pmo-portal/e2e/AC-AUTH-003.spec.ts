import { test, expect } from '@playwright/test';
import { SEED_PASSWORD } from './helpers';

// AC-AUTH-003 — Valid password login lands on dashboard with correct role (FR-AUTH-020, FR-AUTH-032)
//
// This spec is the CANONICAL, AC-tagged proof that a real password login (through GoTrue) actually
// authenticates and lands the correct role. It therefore drives the /login form directly and does
// NOT use the signIn() helper — signIn() now injects a captured session (#306), which would make
// this AC prove session-injection instead of real login. Do not convert this to signIn().
test('AC-AUTH-003: PM password login lands on dashboard with PM nav', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill('pm@acme.test');
  await page.getByLabel(/password/i).fill(SEED_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('Diego Salvatierra')).toBeVisible();

  const sidebar = page.getByRole('navigation', { name: /primary navigation/i });
  await expect(sidebar.getByRole('link', { name: 'Projects' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Sales Pipeline' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Procurement' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Timesheets' })).toBeVisible();
});
