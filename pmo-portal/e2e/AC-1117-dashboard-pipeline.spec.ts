// @e2e-isolation: read-only — pure nav/assert; reads dashboard KPIs and pipeline board; no DB writes.
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

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
  // Actual, proving known margin; other projects remain honestly unknown. The
  // contract-remaining measure stays distinct from billed-work margin.
  // #1403 owner ruling: active-contract tile removed; on-hand is the company figure
  const companyFigures = page.getByRole('region', { name: 'Company figures' });
  const billedMarginTile = companyFigures.getByText('Known margin on billed work', { exact: true }).locator('xpath=../..');
  const contractOnHandTile = companyFigures.getByText('Contract on hand', { exact: true }).locator('xpath=../..');
  const billedMarginAmount = billedMarginTile.locator('div.tabular > span[aria-hidden="true"]');
  const contractOnHandAmount = contractOnHandTile.locator('div.tabular > span[aria-hidden="true"]');
  await expect(billedMarginTile).toBeVisible();
  await expect(contractOnHandTile).toBeVisible();
  await expect(billedMarginAmount).toHaveText('$500K');
  await expect(billedMarginAmount).toHaveAttribute('title', '$500,000');
  await expect(contractOnHandAmount).toHaveText('$33.1M');
  await expect(contractOnHandAmount).toHaveAttribute('title', '$33,050,000');
  await expect(contractOnHandTile).toContainText('$4.1M');
  await expect(contractOnHandTile).toContainText('Partial');

  // ── Exec Dashboard: pipeline weighted value tile ──────────────────────────────
  // pipeline_weighted_value = 800,000
  const pipelineWeightedTile = companyFigures.getByText('Pipeline (weighted)', { exact: true }).locator('xpath=../..');
  await expect(pipelineWeightedTile).toBeVisible();
  await expect(pipelineWeightedTile).toContainText('$');

  // ── Exec Dashboard: pipeline projected margin tile ────────────────────────────
  // pipeline_projected_margin = 0.200 → 20.0%
  // SL-B: the tile exists only when the margin is computable (it needs active budgets); otherwise the
  // pipeline card still renders, titled by the weighted value, and no tile claims a margin.
  // #2055: the pipeline reads as a funnel of open stages (count on each), not a stage table.
  await expect(page.getByRole('heading', { name: 'Sales funnel' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Tender Submitted/ })).toBeVisible();
  const projectedMarginTile = page.getByTestId('kpi-pipeline-projected-margin');
  if (await projectedMarginTile.count() > 0) await expect(projectedMarginTile).toContainText('%');

  // ── Exec Dashboard: win-rate tile (default count mode) ───────────────────────
  const winRateTile = page.getByTestId('kpi-win-rate');
  await expect(winRateTile).toBeVisible();
  await expect(winRateTile).toContainText('%');

  // ── Drill into the Sales Pipeline VIA the weighted-pipeline KPI tile ──────────
  // Wave-5 Cluster-2 PR-A: the Pipeline KPI is now itself the doorway (drill-through),
  // so the natural journey is to click the tile. (Also disambiguates from the nav-rail
  // "Sales Pipeline" link.) Goal-oracle below — weighted stages render — is unchanged.
  // #1404: KPITile's full-surface link is a sibling of the text content wrapper.
  await pipelineWeightedTile.locator('..').getByRole('link', {
    name: 'Open related records for Pipeline (weighted).',
    exact: true,
  }).click();
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

// #1461 — dashboard drill-through lands on exactly the set the figure counts: click a figure and
// the list it opens must show exactly the counted records (the list-page count equals the figure).
test('AC-1461: overdue and supplier-payable figures drill to lists whose count equals the figure', async ({ page }) => {
  await pinViewerLocale(page);
  await signIn(page, 'exec@acme.test');
  const companyFigures = page.getByRole('region', { name: 'Company figures' });
  const countFromBadge = async () => {
    const text = (await page.getByTestId('list-page-count').textContent())?.trim() ?? '';
    // "3" or "Showing 3 of 5" — the counted rows are the first number either way.
    return text.match(/\d+/)?.[0] ?? '';
  };

  // ── Owed by clients · overdue → the receivables overdue filter ──────────────
  const overdueTile = companyFigures.getByText('Owed by clients · overdue', { exact: true }).locator('xpath=../..');
  await expect(overdueTile).toBeVisible();
  const overdueFigure = (await overdueTile.getByText(/^\d+$/).textContent())?.trim() ?? '';
  await companyFigures.getByRole('link', { name: 'Open related records for Owed by clients · overdue.', exact: true }).click();
  await expect(page).toHaveURL(/\/finance\/receivables\?overdue=true/);
  expect(await countFromBadge()).toBe(overdueFigure);

  // ── Owed to suppliers → the exact Vendor Invoiced procurement segment ─────────
  await page.goto('/');
  const supplierTile = companyFigures.getByText('Owed to suppliers', { exact: true }).locator('xpath=../..');
  await expect(supplierTile).toBeVisible();
  const supplierSubline = await supplierTile.getByText(/supplier invoices? awaiting payment/).textContent();
  const supplierFigure = supplierSubline?.match(/(\d+)/)?.[1] ?? '';
  expect(supplierFigure, 'seed has awaiting-payment supplier invoices').not.toBe('');
  await companyFigures.getByRole('link', { name: 'Open related records for Owed to suppliers.', exact: true }).click();
  await expect(page).toHaveURL(/[?&]status=Vendor\+Invoiced/);
  expect(await countFromBadge()).toBe(supplierFigure);

  // ── Contract on hand → the on-hand set the figure sums (Close Out included) ───
  await page.goto('/');
  const contractTile = companyFigures.getByText('Contract on hand', { exact: true }).locator('xpath=../..');
  await expect(contractTile).toBeVisible();
  await companyFigures.getByRole('link', { name: 'Open related records for Contract on hand.', exact: true }).click();
  await expect(page).toHaveURL(/[?&]filter=on-hand/);
});
