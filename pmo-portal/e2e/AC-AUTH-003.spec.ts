// @e2e-isolation: read-only — real password login + nav assertion; no DB writes.
import { test, expect } from '@playwright/test';
import { SEED_PASSWORD } from './helpers';

// AC-AUTH-003 — Valid password login lands on dashboard with correct role (FR-AUTH-020, FR-AUTH-032)
//
// This spec is the CANONICAL, AC-tagged proof that a real password login (through GoTrue) actually
// authenticates and lands the correct role. It therefore drives the /login form directly and does
// NOT use the signIn() helper — signIn() now injects a captured session (#306), which would make
// this AC prove session-injection instead of real login. Do not convert this to signIn().
test('AC-AUTH-003 UIP-011: PM password login lands on dashboard and opens a flagged project by keyboard', async ({ page }) => {
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

  const statusCard = page.getByText('Project Status', { exact: true }).locator('..');
  const flaggedProject = statusCard.getByRole('link', { name: 'Cascade Foods 6.0 MW Ground-Mount PV', exact: true });
  await expect(flaggedProject).toBeVisible();
  await flaggedProject.focus();
  await expect(flaggedProject).toBeFocused();
  await flaggedProject.press('Enter');

  await expect(page).toHaveURL('/projects/41000000-0000-0000-0000-000000000002');
  await expect(page.getByRole('heading', { name: 'Cascade Foods 6.0 MW Ground-Mount PV' })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL('/');
  const returnedStatusCard = page.getByText('Project Status', { exact: true }).locator('..');
  await expect(
    returnedStatusCard.getByRole('link', { name: 'Cascade Foods 6.0 MW Ground-Mount PV', exact: true }),
  ).toBeVisible();
});
