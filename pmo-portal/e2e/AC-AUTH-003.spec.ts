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
  // Shell copy is English in this journey regardless of persisted seed-profile preferences.
  await page.route('**/rest/v1/profiles?*', async (route) => {
    const url = route.request().url();
    if (route.request().method() !== 'GET' || !/[?&]id=eq\./.test(url)) return route.fallback();
    const response = await route.fetch();
    const body: unknown = await response.json();
    if (body && !Array.isArray(body) && typeof body === 'object' && 'locale' in body) {
      return route.fulfill({ response, json: { ...body, locale: 'en', number_locale: 'en-US' } });
    }
    return route.fulfill({ response, json: body });
  });
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

  const statusRegion = page.getByRole('region', { name: 'Project Status' });
  const flaggedProject = statusRegion.getByRole('link', { name: 'Cascade Foods 6.0 MW Ground-Mount PV', exact: true });
  await expect(flaggedProject).toBeVisible();
  await flaggedProject.focus();
  await expect(flaggedProject).toBeFocused();
  await flaggedProject.press('Enter');

  await expect(page).toHaveURL('/projects/41000000-0000-0000-0000-000000000002');
  await expect(page.getByRole('heading', { name: 'Cascade Foods 6.0 MW Ground-Mount PV' })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL('/');
  await expect(page.getByText('Diego Salvatierra')).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Project Status' }).getByRole('link', { name: 'Cascade Foods 6.0 MW Ground-Mount PV', exact: true }),
  ).toBeVisible();
});
