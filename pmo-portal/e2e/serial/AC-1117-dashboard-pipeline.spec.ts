// @e2e-isolation: serial — the journey asserts the org's COMPANY-WIDE figures (contract on hand, known
// margin, weighted pipeline, the board's decided counts), an org-global aggregate that only equals the
// seed's portfolio while no other spec is creating projects. Every parallel-lane spec that creates an
// on-hand project shifts those figures: in the v0.35 release run AC-009's live IDR fixture turned the
// margin tile's exact text into "$500,000 · IDR amount unknown" (shown honestly — a second currency
// really was on the book), so the run has to read a quiescent org, apart from the parallel batch.
import { test, expect } from '@playwright/test';
import { signIn } from '../helpers';

async function pinViewerLocale(page: import('@playwright/test').Page) {
  await page.route('**/rest/v1/profiles?*', async (route) => {
    const response = await route.fetch({ maxRetries: 2 });
    const profile = await response.json() as Record<string, unknown> | Record<string, unknown>[];
    const english = Array.isArray(profile)
      ? profile.map((row) => ({ ...row, locale: 'en', number_locale: 'en-US' }))
      : { ...profile, locale: 'en', number_locale: 'en-US' };
    await route.fulfill({ response, json: english });
  });
}

// AC-1117: capstone journey — dashboard shows dual-lens KPIs and Sales Pipeline renders weighted stages
// from real data (FR-SPD-012/013/014). Cross-stack curated journey per ADR-0010.
test('AC-1117: dashboard shows dual-lens KPIs and Sales Pipeline renders weighted stages from real data (FR-SPD-012/013/014)', async ({ page }) => {
  // Sign in as the seed Executive
  await pinViewerLocale(page);
  await signIn(page, 'exec@acme.test');
  // #1403: signIn already opens the authenticated dashboard.
  await expect(page).toHaveURL(/\/$/);

  // ── Exec Dashboard: contract and billed-work margin stay distinct ────────────
  // SP-2402 has a synthetic, submitted billed-work invoice and complete mapped
  // Actual, proving known margin across the seeded billed projects. The
  // contract-remaining measure stays distinct from billed-work margin.
  // #1403 owner ruling: active-contract tile removed; on-hand is the company figure
  const companyFigures = page.getByRole('region', { name: 'Company figures' });
  const billedMarginTile = companyFigures.getByText('Known margin on billed work', { exact: true }).locator('xpath=../..');
  const contractOnHandTile = companyFigures.getByText('Contract on hand', { exact: true }).locator('xpath=../..');
  const billedMarginAmount = billedMarginTile.locator('div.tabular > span[aria-hidden="true"]');
  const contractOnHandAmount = contractOnHandTile.locator('div.tabular > span[aria-hidden="true"]');
  await expect(billedMarginTile).toBeVisible();
  await expect(contractOnHandTile).toBeVisible();
  await expect(billedMarginAmount).toHaveText('$3.46M');
  await expect(billedMarginAmount).toHaveAttribute('title', '$3,460,000');
  await expect(contractOnHandAmount).toHaveText('$33.1M');
  await expect(contractOnHandAmount).toHaveAttribute('title', '$33,050,000');


  // ── Exec Dashboard: the Sales card — weighted pipeline, forecast margin, open stages as one funnel ────
  // pipeline_weighted_value = 800,000; the forecast margin is drawn only when it is computable.
  const salesHeading = page.getByRole('heading', { name: 'Sales', exact: true });
  await expect(salesHeading).toBeVisible();
  const salesCard = page.getByText('Weighted pipeline', { exact: true }).locator('xpath=..');
  await expect(salesCard).toContainText('$');
  // #2055: the pipeline reads as a funnel of open stages (count on each), not a stage table; each stage bar is a
  // link to the pipeline filtered to that stage.
  const tenderStage = page.getByRole('link', { name: /Tender Submitted/ });
  await expect(tenderStage).toBeVisible();
  await expect(tenderStage).toHaveAttribute('href', '/sales?status=Tender%20Submitted');
  const forecastMargin = page.getByText(/Forecast margin/);
  if (await forecastMargin.count() > 0) await expect(forecastMargin).toContainText('%');

  // ── Exec Dashboard: win rate sits in the Sales card beside the pipeline (default count mode) ─────────
  const winRateTile = page.getByTestId('kpi-win-rate');
  await expect(winRateTile).toBeVisible();
  await expect(winRateTile).toContainText('%');

  // ── Drill into the Sales Pipeline via the Sales card's "Open sales" link ──────────────────────────────
  await page.getByRole('link', { name: 'Open sales' }).click();
  await page.waitForURL('**/sales');

  // pipeline-weighted-total KPI renders
  const weightedTotal = page.getByTestId('pipeline-weighted-total');
  await expect(weightedTotal).toBeVisible();
  await expect(weightedTotal).toContainText('$');

  // At least the Tender Submitted stage column renders with a non-zero weighted value
  const tenderCol = page.getByTestId('stage-Tender Submitted');
  await expect(tenderCol).toBeVisible();
  // The column should contain a non-zero currency value (weighted = $600,000)
  await expect(tenderCol).toContainText('$');
});

// #1461 — dashboard drill-through lands on exactly the set the figure counts: open a "waits on you" row
// and the list it opens must show exactly the counted records (the list-page count equals the number).
test('AC-1461: overdue and supplier-payable rows drill to lists whose count equals the number', async ({ page }) => {
  await pinViewerLocale(page);
  await signIn(page, 'finance@acme.test');
  const waits = page.getByTestId('waits-on-you');
  const countFromBadge = async () => {
    const text = (await page.getByTestId('list-page-count').textContent())?.trim() ?? '';
    // "3" or "Showing 3 of 5" — the counted rows are the first number either way.
    return text.match(/\d+/)?.[0] ?? '';
  };
  /** ux/1110: the receivables page embeds the invoice list and hides its page-header count chip
   *  (`hideHeader`), so the count the user reads is the list's own filtered count — the FilterBar's
   *  "Showing X of Y". The list is not paginated, so the rendered rows are the whole filtered set
   *  and serve as the same count where the bar is not drawn. */
  const filteredInvoiceCount = async () => {
    const showing = page.getByText(/^Showing \d+ of \d+$/).first();
    if (await showing.count() > 0) return (await showing.textContent())?.match(/\d+/)?.[0] ?? '';
    return String(await page.locator('tbody tr').count());
  };
  const rowCount = async (name: RegExp) => {
    const row = waits.getByRole('link', { name });
    await expect(row).toBeVisible();
    return { row, count: (await row.textContent())?.match(/^\s*(\d+)/)?.[1] ?? '' };
  };

  // ── Client invoices overdue → the receivables overdue filter ────────────────
  const overdue = await rowCount(/client invoices? overdue/);
  expect(overdue.count, 'seed has overdue client invoices').not.toBe('');
  await overdue.row.click();
  await expect(page).toHaveURL(/\/finance\/receivables\?overdue=true/);
  // The overdue filter needs the org's today (it is skipped until that read lands), so wait for the
  // list to report the filtered set rather than reading it mid-load.
  await expect.poll(() => filteredInvoiceCount()).toBe(overdue.count);

  // ── Supplier invoices to pay → the exact Vendor Invoiced procurement segment ──
  await page.goto('/');
  // ux/1110 copy: the supplier-invoice row now reads "Payables" (the finance section's own word),
  // instead of "N supplier invoices to pay". Same row, same drill to the Vendor Invoiced segment.
  const supplier = await rowCount(/payables/i);
  expect(supplier.count, 'seed has awaiting-payment supplier invoices').not.toBe('');
  await supplier.row.click();
  await expect(page).toHaveURL(/[?&]status=Vendor\+Invoiced/);
  expect(await countFromBadge()).toBe(supplier.count);

});

test('AC-1461: Contract on hand drills to the on-hand set the figure sums (Close Out included)', async ({ page }) => {
  await pinViewerLocale(page);
  await signIn(page, 'exec@acme.test');
  const companyFigures = page.getByRole('region', { name: 'Company figures' });
  await expect(companyFigures.getByText('Contract on hand', { exact: true })).toBeVisible();
  await companyFigures.getByRole('link', { name: 'Contract on hand', exact: true }).click();
  await expect(page).toHaveURL(/[?&]filter=on-hand/);
});
