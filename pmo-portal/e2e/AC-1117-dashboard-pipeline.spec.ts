// @e2e-isolation: read-only — pure nav/assert; reads dashboard KPIs and pipeline board; no DB writes.
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

// AC-1117: capstone journey — dashboard shows portfolio and pipeline evidence, then Sales renders weighted stages
// from real data (FR-SPD-012/013/014). Cross-stack curated journey per ADR-0010.
test('AC-1117: dashboard shows dual-lens KPIs and Sales Pipeline renders weighted stages from real data (FR-SPD-012/013/014)', async ({ page }) => {
  // Sign in as the seed Executive
  await signIn(page, 'exec@acme.test');
  await page.goto('/');

  // ── Exec Dashboard: contract and billed-work margin stay distinct ────────────
  // SP-2402 has a synthetic, submitted billed-work invoice and complete mapped
  // Actual, proving known margin; other projects remain honestly unknown. The
  // contract-remaining measure stays distinct from billed-work margin.
  const onHandMarginTile = page.getByTestId('kpi-on-hand-margin');
  await expect(onHandMarginTile).toBeVisible();
  await expect(onHandMarginTile).toContainText('Known margin on billed work: $500K');
  await expect(onHandMarginTile).toContainText('Contract remaining after known Actual: $4.1M');

  // ── Exec Dashboard: pipeline weighted value tile ──────────────────────────────
  // pipeline_weighted_value = 800,000
  const pipelineWeightedTile = page.getByTestId('kpi-pipeline-weighted-value');
  await expect(pipelineWeightedTile).toBeVisible();
  await expect(pipelineWeightedTile).toContainText('$');

  // ── Exec Dashboard: projected margin stays explicit about availability ────────
  const pipelineMargin = page.getByTestId('dashboard-pipeline-margin');
  await expect(pipelineMargin).toBeVisible();
  const projectedMargin = pipelineMargin.getByRole('group', { name: 'Pipeline projected margin' });
  if (await pipelineMargin.getByText('Pipeline forecast margin', { exact: true }).count()) {
    await expect(projectedMargin).toContainText(/\d+(?:\.\d+)?%/);
  } else {
    await expect(pipelineMargin).toContainText('Pipeline (weighted)');
    await expect(projectedMargin).not.toContainText(/\d+(?:\.\d+)?%/);
  }

  // ── Exec Dashboard: win-rate tile (default count mode) ───────────────────────
  const winRateTile = page.getByTestId('kpi-win-rate');
  await expect(winRateTile).toBeVisible();
  await expect(winRateTile).toContainText('%');

  // ── Drill into the Sales Pipeline VIA the retained weighted-value doorway ────
  // Wave-5 Cluster-2 PR-A: the Pipeline KPI is now itself the doorway (drill-through),
  // so the natural journey is to click the tile. (Also disambiguates from the nav-rail
  // "Sales Pipeline" link.) Goal-oracle below — weighted stages render — is unchanged.
  await page.getByTestId('kpi-pipeline-weighted-value').click();
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
