import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

// AC-SP-207/208/209: index-first Sales Pipeline — Kanban/Table toggle, card → opportunity
// detail page (record tab + label hydration), and the win/loss SoD panel. Curated cross-stack
// journey per ADR-0010 (real RLS rows, real transition contract).
test('AC-SP-207: opens an opportunity from the Kanban board into its detail page and tab', async ({ page }) => {
  await signIn(page, 'exec@acme.test');

  // Navigate to the Sales Pipeline via the rail NavLink.
  await page.getByRole('link', { name: /Sales Pipeline/i }).click();
  await page.waitForURL('**/sales');

  // Kanban is the default view — the Tender column carries the seeded deal.
  const board = page.getByLabel('Sales pipeline board');
  await expect(board).toBeVisible();

  // Drill into the seeded Tender deal.
  await page.getByText('Northwind ERP Rollout').first().click();
  await page.waitForURL('**/sales/**');

  // Detail page: header name + BackBar + the deal-stage journey.
  await expect(page.getByRole('heading', { name: /Northwind ERP Rollout/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Back to Sales Pipeline/i })).toBeVisible();
  await expect(page.getByLabel('Deal stage journey')).toBeVisible();

  // The Mark-won inline SoD panel reveals two required fields (no modal).
  await page.getByRole('button', { name: /Mark won/i }).click();
  await expect(page.getByLabel(/Customer contract reference/i)).toBeVisible();
  await expect(page.getByLabel(/Contract date/i)).toBeVisible();
});

test('AC-SP-206: the view toggle switches the body to a Table of deals', async ({ page }) => {
  await signIn(page, 'exec@acme.test');
  await page.getByRole('link', { name: /Sales Pipeline/i }).click();
  await page.waitForURL('**/sales');

  await page.getByRole('tab', { name: /Table/i }).click();
  // Table view renders the seeded deal in a row with a win-% progressbar.
  await expect(page.getByText('Northwind ERP Rollout')).toBeVisible();
  await expect(page.getByRole('progressbar').first()).toBeVisible();
});
