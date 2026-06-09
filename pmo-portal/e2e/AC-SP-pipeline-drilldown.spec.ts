import { test, expect } from '@playwright/test';
import { signIn, openPipelineCard } from './helpers';

// AC-SP-207/208/209: index-first Sales Pipeline — Kanban/Table toggle, card → opportunity
// detail page (record tab + label hydration), and the win/loss SoD panel. Curated cross-stack
// journey per ADR-0010 (real RLS rows, real transition contract).
//
// ISOLATION NOTE: These specs use P011 "Highfield Bridge Survey" (a dedicated e2e-only seed row)
// rather than P002 "Northwind ERP Rollout". P002 is mutated by AC-1011 and read by AC-1117;
// pointing AC-SP at a distinct project ensures full-suite ordering-independence (no shared
// mutable row between specs). P011 is seeded in 'Tender Submitted' state on every db reset.
//
// NOTE (feat/ui-polish I7): the in-page BackBar ("Back to Sales Pipeline" button) was
// intentionally removed on the success render — the top-bar breadcrumb owns wayfinding.
// AC-SP-207 asserts that the breadcrumb link "Sales Pipeline" navigates back to /sales.
//
// Model B (ADR-0020): a pipeline deal opens at the ONE canonical detail route /projects/:id
// (was /sales/:id), with the stage-adaptive PIPELINE lens; its breadcrumb ancestry follows the
// stage, so a pre-win deal still reads "Sales Pipeline > <name>" and the crumb links to /sales.
test('AC-SP-207: opens a deal from the Kanban board into its canonical detail page (pipeline lens)', async ({ page }) => {
  await signIn(page, 'exec@acme.test');

  // Navigate to the Sales Pipeline via the rail NavLink.
  await page.getByRole('link', { name: 'Sales Pipeline', exact: true }).click();
  await page.waitForURL('**/sales');

  // Kanban is the default view — the Tender column carries the seeded deal.
  const board = page.getByLabel('Sales pipeline board');
  await expect(board).toBeVisible();

  // Drill into P011 "Highfield Bridge Survey" (dedicated AC-SP isolation seed row).
  // openPipelineCard retries the click until the canonical /projects/:id route is reached (the
  // card's click→navigate can be swallowed if fired pre-hydration under parallel-suite load).
  await openPipelineCard(page, 'Highfield Bridge Survey');

  // Detail page: header name + Deal stage journey stepper (the pipeline lens).
  await expect(page.getByRole('heading', { name: /Highfield Bridge Survey/i })).toBeVisible();
  await expect(page.getByLabel('Deal stage journey')).toBeVisible();

  // I7: the in-page BackBar ("Back to Sales Pipeline" button) was removed.
  // The breadcrumb (rendered in the top ContextBar, inside nav[aria-label="Breadcrumb"])
  // owns wayfinding. Assert the breadcrumb "Sales Pipeline" link navigates back to /sales.
  const breadcrumb = page.getByRole('navigation', { name: /breadcrumb/i });
  await expect(breadcrumb).toBeVisible();
  const salesPipelineLink = breadcrumb.getByRole('button', { name: /Sales Pipeline/i });
  await expect(salesPipelineLink).toBeVisible({ timeout: 10_000 });
  await salesPipelineLink.click();
  await page.waitForURL('**/sales');

  // Navigated back — the Kanban board is visible again.
  await expect(page.getByLabel('Sales pipeline board')).toBeVisible();
});

test('AC-SP-206: the view toggle switches the body to a Table of deals', async ({ page }) => {
  await signIn(page, 'exec@acme.test');
  await page.getByRole('link', { name: 'Sales Pipeline', exact: true }).click();
  await page.waitForURL('**/sales');

  await page.getByRole('tab', { name: /Table/i }).click();
  // Table view renders P011 (dedicated AC-SP seed row) in a row with a win-% progressbar.
  await expect(page.getByText('Highfield Bridge Survey')).toBeVisible();
  await expect(page.getByRole('progressbar').first()).toBeVisible();
});

test('AC-SP-208: Mark-won inline SoD panel reveals contract-reference + contract-date fields', async ({ page }) => {
  await signIn(page, 'exec@acme.test');
  await page.getByRole('link', { name: 'Sales Pipeline', exact: true }).click();
  await page.waitForURL('**/sales');

  await openPipelineCard(page, 'Highfield Bridge Survey');

  // The Mark-won inline SoD panel reveals two required fields (no modal).
  await page.getByRole('button', { name: /Mark won/i }).click();
  await expect(page.getByLabel(/Customer contract reference/i)).toBeVisible();
  await expect(page.getByLabel(/Contract date/i)).toBeVisible();
});
