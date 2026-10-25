// @e2e-isolation: read-only — only navigates/asserts filter+search+return state; no DB write.
import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * AC-LRC-004 (list-working-set-return, #682): a narrowed Sales Pipeline, opened project record,
 * and a return via the project's quiet "Back to Sales Pipeline" wayfinding link restores the same
 * scope/stage/search/sort/scroll working set — while the record path and Projects breadcrumb stay
 * canonical, structural, and UNAFFECTED by the Sales context (design decision 3 / FR-LRC-006).
 *
 * Seed: "Riverside Plastics 2.1 MW Carport PV" and "Northwind ERP Rollout" are both Tender
 * Submitted; "Cascade Foods Phase 2 — 4.0 MW Extension" is PQ Submitted (excluded by the Tender
 * Stage selector). The user selects Table, then Stage and Sort in the unified toolbar. Selecting
 * Tender narrows OUT the PQ row;
 * searching "Riverside" then narrows OUT "Northwind ERP Rollout" too (its name has no "Riverside"
 * substring) — so each control visibly removes a row, and the Sales-link return must bring back
 * exactly that narrowed set, not just the URL. Neither fixture is mutated by any other spec.
 */

test.setTimeout(120_000);

async function waitReady(page: Page) {
  await expect(page.getByTestId('liststate-loading')).toHaveCount(0, { timeout: 20_000 });
}

test(
  'AC-LRC-004: narrowing the Sales Pipeline, opening a project, and returning via the PipelineLens Sales link restores the funnel-stage/search/scroll — the record path and Projects breadcrumb/BackBar stay canonical',
  async ({ page }) => {
    // A small viewport height, not width, forces the table to overflow `.main-scroll` even with
    // a handful of seeded rows, so the scroll-restore assertion is real, not trivially 0.
    await page.setViewportSize({ width: 1280, height: 420 });
    await login(page, 'pm@acme.test');
    await page.goto('/sales');
    await waitReady(page);

    // ── Switch to Table while retaining the same Open scope ───────────────────────────────
    await page.getByRole('tab', { name: /^Table$/i }).click();
    await expect(page).toHaveURL(/[?&]view=table/);
    const table = page.getByRole('table');

    // ── Narrow: Stage=Tender, newest activity first, then search for Riverside ─────────────
    await page.getByRole('combobox', { name: 'Stage' }).selectOption('Tender Submitted');
    await expect(page).toHaveURL(/[?&]status=Tender\+Submitted/);
    await page.getByRole('combobox', { name: 'Sort' }).selectOption('activity-newest');
    await expect(page).toHaveURL(/[?&]sort=activity-newest/);
    await expect(table.getByText('Northwind ERP Rollout')).toBeVisible();
    await expect(table.getByText('Cascade Foods Phase 2')).not.toBeVisible();
    const search = page.getByRole('searchbox', { name: /Search projects/i });
    await search.fill('Riverside');
    await expect(page).toHaveURL(/[?&]q=Riverside/);
    await expect(table.getByText('Northwind ERP Rollout')).not.toBeVisible();
    await expect(table.getByText('Riverside Plastics 2.1 MW Carport PV')).toBeVisible();

    const narrowedSalesUrl = page.url();
    const mainScroll = page.locator('.main-scroll');
    await mainScroll.evaluate((element) => { element.scrollTop = Math.min(160, element.scrollHeight - element.clientHeight); });
    const capturedScrollTop = await mainScroll.evaluate((element) => element.scrollTop);
    expect(capturedScrollTop).toBeGreaterThan(0);

    // ── Open the project from the Sales table; the record path stays canonical /projects/:id ──
    await table.getByText('Riverside Plastics 2.1 MW Carport PV').click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/i, { timeout: 15_000 });
    await expect(page.getByTestId('record-header')).toContainText('Riverside Plastics 2.1 MW Carport PV');

    // ── The structural Projects breadcrumb/BackBar are UNAFFECTED by the Sales context: they
    //    return to the bare Projects index, never the narrowed Sales URL (design decision 3). ──
    await page
      .getByRole('navigation', { name: /breadcrumb/i })
      .getByRole('link', { name: /^projects$/i })
      .click();
    await expect(page).toHaveURL(/\/projects$/, { timeout: 10_000 });

    // ── Re-open the project from the SAME narrowed Sales URL to test the quiet Sales link ─────
    await page.goto(narrowedSalesUrl);
    await waitReady(page);
    await table.getByText('Riverside Plastics 2.1 MW Carport PV').click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/i, { timeout: 15_000 });
    const recordUrl = page.url();
    const salesLink = page.getByRole('link', { name: /back to sales pipeline/i });
    await expect(salesLink).toBeVisible();
    await salesLink.click();
    await expect(page).toHaveURL(/[?&]status=Tender\+Submitted/, { timeout: 10_000 });
    await expect(page).toHaveURL(/[?&]q=Riverside/);
    await waitReady(page);
    await expect(page.getByRole('combobox', { name: 'Project scope' })).toHaveValue('Open');
    await expect(page.getByRole('combobox', { name: 'Stage' })).toHaveValue('Tender Submitted');
    await expect(page.getByRole('combobox', { name: 'Sort' })).toHaveValue('activity-newest');
    await expect.poll(() => mainScroll.evaluate((element) => element.scrollTop)).toBe(capturedScrollTop);
    // The narrowed SET came back, not just the URL: the searched-out and filtered-out rows stay
    // out. Scoped to the table so the locator can't transiently match the breadcrumb/heading of
    // the just-departed detail page during the return transition (strict-mode ambiguity).
    await expect(table.getByText('Riverside Plastics 2.1 MW Carport PV')).toBeVisible();
    await expect(table.getByText('Northwind ERP Rollout')).not.toBeVisible();
    await expect(table.getByText('Cascade Foods Phase 2')).not.toBeVisible();
    // ── A direct project link carries no Sales context — the Sales link falls back to bare
    //    /sales, and the Projects breadcrumb stays canonical. ──────────────────────────────
    const freshPage = await page.context().newPage();
    await freshPage.goto(recordUrl);
    await expect(freshPage.getByTestId('record-header')).toContainText(
      'Riverside Plastics 2.1 MW Carport PV',
      { timeout: 15_000 },
    );
    await expect(freshPage.getByRole('link', { name: /back to sales pipeline/i })).toHaveAttribute(
      'href',
      '/sales',
    );
    await freshPage
      .getByRole('navigation', { name: /breadcrumb/i })
      .getByRole('link', { name: /^projects$/i })
      .click();
    await expect(freshPage).toHaveURL(/\/projects$/, { timeout: 10_000 });
    await freshPage.close();
  },
);
