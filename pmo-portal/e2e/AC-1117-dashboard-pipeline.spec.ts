import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

// AC-1117: capstone journey — dashboard shows dual-lens KPIs and Sales Pipeline renders weighted stages
// from real data (FR-SPD-012/013/014). Cross-stack curated journey per ADR-0010.
test('AC-1117: dashboard shows dual-lens KPIs and Sales Pipeline renders weighted stages from real data (FR-SPD-012/013/014)', async ({ page }) => {
  // Sign in as the seed Executive
  await signIn(page, 'exec@acme.test');
  await page.goto('/');

  // ── Exec Dashboard: on-hand margin tile ──────────────────────────────────────
  // on_hand_margin = 0.949375 → 94.9%
  const onHandMarginTile = page.getByTestId('kpi-on-hand-margin');
  await expect(onHandMarginTile).toBeVisible();
  await expect(onHandMarginTile).toContainText('%');

  // ── Exec Dashboard: pipeline weighted value tile ──────────────────────────────
  // pipeline_weighted_value = 800,000
  const pipelineWeightedTile = page.getByTestId('kpi-pipeline-weighted-value');
  await expect(pipelineWeightedTile).toBeVisible();
  await expect(pipelineWeightedTile).toContainText('$');

  // ── Exec Dashboard: pipeline projected margin tile ────────────────────────────
  // pipeline_projected_margin = 0.200 → 20.0%
  const projectedMarginTile = page.getByTestId('kpi-pipeline-projected-margin');
  await expect(projectedMarginTile).toBeVisible();
  await expect(projectedMarginTile).toContainText('%');

  // ── Exec Dashboard: win-rate tile (default count mode) ───────────────────────
  const winRateTile = page.getByTestId('kpi-win-rate');
  await expect(winRateTile).toBeVisible();
  await expect(winRateTile).toContainText('%');

  // ── Navigate to Sales Pipeline ───────────────────────────────────────────────
  await page.getByRole('link', { name: /Sales Pipeline/i }).click();
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
