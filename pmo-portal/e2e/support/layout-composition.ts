import { expect, type Page } from '@playwright/test';
import { waitForFonts } from '../helpers';

/**
 * COMPOSITION assertions: each pins a CURRENT ARRANGEMENT, not a user outcome (OD-VISUAL-RESET,
 * docs/decisions.md: composition rulings are evidence a design pass may overturn). Moved here
 * unchanged from layout-oracles.ts (#2205); thresholds are identical. When a screen is recomposed
 * and approved on rendered screenshots, update or retire the matching assertion HERE; the
 * behavioural oracles in layout-oracles.ts (containment, reach, focus, no bleed, money) stay.
 * Owning requirement per assertion: docs/specs/layout-oracles.spec.md.
 *
 *  - assertFunnelBarGapAndAlignment: an 8px gap and equal bar tops (AC-SFA-006) is a spacing
 *    arrangement; owner = docs/ux/screen-rules.md "Graphics" (funnel = descending bars on one scale).
 *  - assertRecordHeaderStacksTitleAboveStatus: title strictly above status (UIP-009) is an
 *    arrangement; owner = docs/ux/screen-rules.md "One name, one look" (record header).
 */

/** AC-SFA-006: each populated stage bar keeps an 8px gap below its weighted line and all drawn bar
 *  tops align across the row (1px rendering tolerance). Stages with no deals intentionally draw no bar. */
export async function assertFunnelBarGapAndAlignment(page: Page) {
  await expect(page.locator('[data-funnel-stage]')).toHaveCount(5);
  await waitForFonts(page);

  const bars = await page.evaluate(() => {
    const results: { i: number; weightedBottom: number; barTop: number }[] = [];
    document.querySelectorAll('[data-funnel-stage]').forEach((stageEl, i) => {
      const weighted = stageEl.querySelector('[data-funnel-stage-weighted]');
      const bar = stageEl.querySelector('[data-funnel-stage-bar]');
      if (!weighted || !bar) return;
      results.push({
        i,
        weightedBottom: weighted.getBoundingClientRect().bottom,
        barTop: bar.getBoundingClientRect().top,
      });
    });
    return results;
  });

  expect(bars, 'expected a weighted line + progress bar for at least one populated stage').not.toHaveLength(0);

  for (const { i, weightedBottom, barTop } of bars) {
    expect(
      barTop - weightedBottom,
      `stage ${i} bar sits closer than 8px below its weighted line: gap=${(barTop - weightedBottom).toFixed(1)}px`,
    ).toBeGreaterThanOrEqual(7);
  }

  const barTops = bars.map((b) => b.barTop);
  const firstTop = barTops[0];
  for (const [i, top] of barTops.entries()) {
    expect(
      Math.abs(top - firstTop),
      `stage ${i} bar top (${top.toFixed(1)}) is not aligned with stage 0's bar top (${firstTop.toFixed(1)})`,
    ).toBeLessThanOrEqual(1);
  }
}

/** UIP-009: the phone record header stacks the full title above the status chip, the title never
 *  clips, and the page never pans. */
export async function assertRecordHeaderStacksTitleAboveStatus(page: Page, title: string, statusText: string) {
  const header = page.getByTestId('record-header');
  const titleLoc = header.getByRole('heading', { name: title, exact: true });
  await expect(titleLoc).toBeVisible();
  await waitForFonts(page);
  const titleBox = (await titleLoc.boundingBox())!;
  const statusBox = (await header.getByText(statusText, { exact: true }).boundingBox())!;
  expect(statusBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height);
  expect(await titleLoc.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
