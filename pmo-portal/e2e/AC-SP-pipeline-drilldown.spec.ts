// @e2e-isolation: read-only — signIn + pipeline kanban/table + detail page nav/assert on dedicated P011; no DB writes.
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
// AC-SP-207 asserts that the breadcrumb parent link navigates back to the list.
//
// FIX-2 (coherence wave): /projects/:id ALWAYS roots at "Projects" in the breadcrumb,
// regardless of pipeline status — the pipeline status is surfaced via the stage pill and
// stepper, not the breadcrumb ancestry. So the breadcrumb reads "Projects > <name>" and
// clicking "Projects" navigates to /projects (the on-hand list), not /sales.
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

  // Detail page: header name + Project stage journey stepper (the pipeline lens).
  // CW-1 r2fix-enforce: aria-label updated from "Deal stage journey" → "Project stage journey".
  await expect(page.getByRole('heading', { name: /Highfield Bridge Survey/i })).toBeVisible();
  await expect(page.getByLabel('Project stage journey')).toBeVisible();

  // I7: the in-page BackBar was removed. The breadcrumb (in nav[aria-label="Breadcrumb"])
  // owns wayfinding. FIX-2 (coherence): breadcrumb now always reads "Projects > <name>";
  // clicking "Projects" navigates to /projects (the on-hand list).
  const breadcrumb = page.getByRole('navigation', { name: /breadcrumb/i });
  await expect(breadcrumb).toBeVisible();
  const projectsLink = breadcrumb.getByRole('button', { name: /^Projects$/i });
  await expect(projectsLink).toBeVisible({ timeout: 10_000 });
  await projectsLink.click();
  await page.waitForURL('**/projects');

  // Navigated back to the Projects list — the list is visible.
  await expect(page.getByRole('main')).toBeVisible();
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
