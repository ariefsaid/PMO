import { expect, type Page } from '@playwright/test';
import { waitForFonts } from '../helpers';
import { stripLuminance } from './layout-oracles';

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
 *  - assertProjectsTableComposition: the 12px gap between the Actual and Progress headers is a
 *    spacing arrangement (split out of assertProjectsTableLayout, #2205).
 *  - expectHairlineVisible: the sticky-cell divider hairline luminance is a look.
 *  - assertGroupedProcurementValueAlignment: Value-column right edge + tabular numerals (UIP-007)
 *    is an alignment arrangement.
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

/** Spacing half of the former assertProjectsTableLayout: header gap measured at 1440px. */
export async function assertProjectsTableComposition(page: Page) {
  const scroller = page.getByTestId('dt-table-branch');
  await expect(scroller).toBeVisible({ timeout: 20_000 });
  await expect(scroller.locator('tbody tr').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  await waitForFonts(page);
  const actualHeader = scroller.getByRole('columnheader', { name: /Spent/ });
  const progressHeader = scroller.getByRole('columnheader', { name: 'Progress', exact: true });
  const actualText = await actualHeader.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element.firstChild!);
    const box = range.getBoundingClientRect();
    return { left: box.left, right: box.right };
  });
  const progressText = await progressHeader.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element.firstChild!);
    const box = range.getBoundingClientRect();
    return { left: box.left, right: box.right };
  });
  expect(progressText.left - actualText.right).toBeGreaterThanOrEqual(12);
}

/** The inset hairline on the sticky cells' left edge must actually render (travels with the cell). */
export async function expectHairlineVisible(page: Page, tdLeft: number, scroller: { top: number; bottom: number }, mode: 'light' | 'dark') {
  const bandBottom = Math.min(scroller.top + 92, scroller.bottom - 2);
  const lums = await stripLuminance(page, tdLeft + 0.25, scroller.top + 1, 1, bandBottom - scroller.top - 1);
  const min = Math.min(...lums);
  const max = Math.max(...lums);
  if (mode === 'light') {
    expect(
      min,
      `divider hairline must be visible in light mode (min luminance ${min.toFixed(1)} — absent reads as pure card white 255)`,
    ).toBeLessThanOrEqual(247);
  } else {
    expect(
      max,
      `divider hairline must be visible in dark mode (max luminance ${max.toFixed(1)} — absent reads as flat card ~28)`,
    ).toBeGreaterThanOrEqual(33);
  }
}

/** UIP-007: comparative procurement values share one right edge with each other and the Value
 *  column header, set in tabular numerals (1px tolerance). */
export async function assertGroupedProcurementValueAlignment(page: Page) {
  await expect(page.locator('[data-procurement-value]')).toHaveCount(2);
  await waitForFonts(page);
  const edges = await page.locator('[data-procurement-value]').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().right));
  expect(Math.abs(edges[0] - edges[1])).toBeLessThanOrEqual(1);
  const headerEdge = await page.getByTestId('procurement-list-columns').getByText('Value', { exact: true }).evaluate((node) => node.getBoundingClientRect().right);
  expect(Math.abs(headerEdge - edges[0])).toBeLessThanOrEqual(1);
  await expect(page.locator('[data-procurement-value]').first()).toHaveCSS('font-variant-numeric', 'tabular-nums');
}
