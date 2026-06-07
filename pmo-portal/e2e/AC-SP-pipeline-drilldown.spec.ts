import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

// AC-SP-207/208/209: index-first Sales Pipeline — Kanban/Table toggle, card → opportunity
// detail page (record tab + label hydration), and the win/loss SoD panel. Curated cross-stack
// journey per ADR-0010 (real RLS rows, real transition contract).
//
// ISOLATION NOTE: These specs use P011 "Highfield Bridge Survey" (a dedicated e2e-only seed row)
// rather than P002 "Northwind ERP Rollout". P002 is mutated by AC-1011 and read by AC-1117;
// pointing AC-SP at a distinct project ensures full-suite ordering-independence (no shared
// mutable row between specs). P011 is seeded in 'Tender Submitted' state on every db reset.
test('AC-SP-207: opens an opportunity from the Kanban board into its detail page and tab', async ({ page }) => {
  await signIn(page, 'exec@acme.test');

  // Navigate to the Sales Pipeline via the rail NavLink.
  await page.getByRole('link', { name: /Sales Pipeline/i }).click();
  await page.waitForURL('**/sales');

  // Kanban is the default view — the Tender column carries the seeded deal.
  const board = page.getByLabel('Sales pipeline board');
  await expect(board).toBeVisible();

  // Drill into P011 "Highfield Bridge Survey" (dedicated AC-SP isolation seed row).
  await page.getByText('Highfield Bridge Survey').first().click();
  await page.waitForURL('**/sales/**');

  // Detail page: header name + BackBar + the deal-stage journey.
  await expect(page.getByRole('heading', { name: /Highfield Bridge Survey/i })).toBeVisible();
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
  // Table view renders P011 (dedicated AC-SP seed row) in a row with a win-% progressbar.
  await expect(page.getByText('Highfield Bridge Survey')).toBeVisible();
  await expect(page.getByRole('progressbar').first()).toBeVisible();
});
