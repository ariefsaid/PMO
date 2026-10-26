// @e2e-isolation: read-only — pure nav/assert; login + dashboard KPI assertions on seeded data; no DB writes.
import { test, expect } from '@playwright/test';
import { login } from './helpers';

// AC-701 (+ AC-709 org-scope) — real RPC over the real seed yields org-scoped KPIs in the real UI.
test('AC-701 Executive sees real org-scoped KPI values from the RPC', async ({ page }) => {
  await login(page, 'exec@acme.test');
  await page.goto('/');
  const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
  await expect(breadcrumb).toContainText('Home');
  await expect(breadcrumb).toContainText('Dashboard');
  // SP-2401 + SP-2402 + P001 + P003 + P013 = 5 Ongoing projects (rich solar seed, PR-#118 resync)
  // The active-only contract and count remain together in the Delivery book.
  const deliveryBook = page.getByTestId('dashboard-delivery-book');
  await expect(deliveryBook.getByText('Active contract value').first().locator('xpath=following-sibling::dd[1]'))
    .toContainText('5 active projects');
  // SP-2401 5,250,000 + SP-2402 7,800,000 + P001 5,000,000 + P003 3,000,000 + P013 2,000,000 = 23,050,000
  // The row shows the exact value with its currency, rather than a shortened KPI figure.
  await expect(deliveryBook.getByText('Active contract value').first().locator('xpath=following-sibling::dd[1]'))
    .toContainText('$23,050,000');
});
