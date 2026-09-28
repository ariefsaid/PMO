// @e2e-isolation: read-only — reads the seeded Sales Pipeline and measures rendered boxes; no writes.
/**
 * AC-SFA-001 — Sales Pipeline funnel amounts stay contained in their own stage at 390px.
 *
 * ORACLE: the Sales Pipeline's five-stage funnel is horizontally scrollable at phone width
 * (each stage keeps at least a 10rem floor so the exact formatted amount never clips or
 * overlaps its neighbour). We measure the DOM geometry directly — every stage's amount
 * bounding box must lie inside its own stage box — and assert the page itself never pans
 * sideways (documentElement.scrollWidth <= viewport), so the deliberate funnel scroller
 * owns its overflow instead of leaking it to the whole page.
 *
 * This is the browser geometry proof for FR-SFA-001 / AC-SFA-001; the component-level
 * contracts for the shared Funnel live in the RTL suite (AC-SFA-004).
 */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

/** Currency symbol + a grouped thousands separator — the noncompact long-number shape. */
const LONG_AMOUNT_SHAPE = /[\p{Sc}]\s?\d{1,3}(?:[.,]\d{3})+/u;

test.describe('AC-SFA-001 sales funnel amount geometry @mobile', () => {
  test('AC-SFA-001: every stage amount stays inside its own stage; page does not pan at 390px', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, 'admin@acme.test');
    await page.goto('/sales');

    // The funnel band renders five fixed open stages, each tagged with a stable hook.
    await expect(page.getByRole('region', { name: 'Pipeline summary' })).toBeVisible();
    await expect(page.locator('[data-funnel-stage]')).toHaveCount(5);

    // Exercise the geometry against a noncompact representative amount: at least one stage
    // must show a currency symbol plus a grouped thousands separator (not a compact form).
    const amounts = await page.locator('[data-funnel-stage-amount]').allTextContents();
    expect(
      amounts.some((text) => LONG_AMOUNT_SHAPE.test(text)),
      `expected a grouped long amount among stage values, got: ${amounts.join(' | ')}`,
    ).toBe(true);

    // For every stage, the amount's box must lie inside the stage's own box (tolerance 1px).
    const containment = await page.evaluate(() => {
      const results: { i: number; stage: DOMRect | null; amount: DOMRect | null }[] = [];
      document.querySelectorAll('[data-funnel-stage]').forEach((stageEl, i) => {
        const amount = stageEl.querySelector('[data-funnel-stage-amount]');
        results.push({
          i,
          stage: stageEl.getBoundingClientRect().toJSON() as unknown as DOMRect,
          amount: amount ? (amount.getBoundingClientRect().toJSON() as unknown as DOMRect) : null,
        });
      });
      return results;
    });

    for (const { i, stage, amount } of containment) {
      expect(stage, `stage ${i} box missing`).not.toBeNull();
      expect(amount, `stage ${i} amount box missing`).not.toBeNull();
      const sx = stage!.x;
      const sw = stage!.width;
      const ax = amount!.x;
      const aw = amount!.width;
      expect(
        ax,
        `stage ${i} amount starts before its stage: amount.x=${ax.toFixed(1)} < stage.x=${sx.toFixed(1)}`,
      ).toBeGreaterThanOrEqual(sx - 1);
      expect(
        ax + aw,
        `stage ${i} amount overflows its stage: amount.right=${(ax + aw).toFixed(1)} > stage.right=${(sx + sw).toFixed(1)}`,
      ).toBeLessThanOrEqual(sx + sw + 1);
    }

    // The funnel scroller must contain its own overflow — the page never pans sideways.
    const pageScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(pageScrollWidth).toBeLessThanOrEqual(392);
  });
});