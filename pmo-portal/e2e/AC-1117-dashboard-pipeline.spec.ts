// @e2e-isolation: read-only — pure nav/assert; reads dashboard KPIs and pipeline board; no DB writes.
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

// AC-1117: capstone journey — dashboard keeps delivery measures distinct and Sales Pipeline renders weighted stages
// from real data (FR-SPD-012/013/014). Cross-stack curated journey per ADR-0010.
test('AC-1117: dashboard shows delivery measures and a stable win-rate figure before opening a weighted stage (FR-SPD-012/013/014)', async ({ page }) => {
  // Sign in as the seed Executive
  await signIn(page, 'exec@acme.test');
  await page.goto('/');

  // ── Exec Dashboard: contract and billed-work margin stay distinct ────────────
  // SP-2402 has a synthetic, submitted billed-work invoice and complete mapped
  // Actual, proving known margin; other projects remain honestly unknown. The
  // contract-remaining measure stays distinct from billed-work margin.
  const deliveryBook = page.getByTestId('dashboard-delivery-book');
  await expect(deliveryBook).toBeVisible();
  await expect(deliveryBook.getByText('Known margin on billed work').locator('xpath=following-sibling::dd[1]'))
    .toContainText('$500,000');
  await expect(deliveryBook.getByText('Contract remaining after known Actual').first().locator('xpath=following-sibling::dd[1]'))
    .toContainText('$4,070,000');

  // ── Exec Dashboard: pipeline weighted value tile ──────────────────────────────
  // pipeline_weighted_value = 800,000
  const pipeline = page.getByTestId('dashboard-pipeline');
  await expect(pipeline).toBeVisible();
  const weighted = pipeline.getByText(/Weighted pipeline ·/);
  const gross = pipeline.getByText(/Gross pipeline ·/);
  await expect(weighted).toBeVisible();
  await expect(gross).toBeVisible();

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
  const winRateFigure = page.getByTestId('win-rate-figure');
  await expect(winRateFigure).toBeVisible();
  await expect(winRateFigure.getByTestId('win-rate-track-count')).toBeVisible();
  const period = page.getByRole('button', { name: 'Last quarter' });
  await period.click();
  await expect(page).toHaveURL(/winRatePeriod=q/);
  await page.getByRole('button', { name: 'By value' }).click();
  await expect(page).toHaveURL(/winRateBasis=value/);
  await expect(winRateFigure).toBeVisible();
  await expect(winRateFigure.locator('[data-testid^="win-rate-track-"]').first()).toBeVisible();

  // The weighted stage row is the doorway; opening it lands on the selected sales stage.
  const tenderStage = pipeline.locator('a[href="/sales?status=Tender%20Submitted"]');
  await expect(tenderStage).toBeVisible();
  await expect(tenderStage).toContainText('$');
  await tenderStage.click();
  await page.waitForURL('**/sales?status=Tender%20Submitted');
  await expect(page.getByTestId('stage-Tender Submitted')).toBeVisible();
});
