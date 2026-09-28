// @e2e-isolation: read-only — reads the seeded Sales Pipeline and measures rendered boxes; no writes.
/**
 * AC-SFA-001 — Sales Pipeline funnel amounts stay contained in their own stage at 390px.
 *
 * ORACLE: the Sales Pipeline's five-stage funnel is horizontally scrollable at phone width
 * (each stage's column grows with its own content — an intrinsic `max-content` track floor,
 * not a fixed one — so the exact formatted amount never clips or overlaps its neighbour). We
 * measure the DOM geometry directly — every stage's amount bounding box must lie inside its
 * own stage box — and assert the page itself never pans sideways (documentElement.scrollWidth
 * <= viewport), so the deliberate funnel scroller owns its overflow instead of leaking it to
 * the whole page.
 *
 * The seeded pipeline is USD, so the geometry is ALSO probed against a representative long IDR
 * amount (trillions scale) — the org-currency worst case a real RIS tenant renders. Since
 * there is no supported way to change the seeded org's currency from an e2e spec, the probe
 * substitutes the rendered text of every stage amount with a deterministic
 * `Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' })` figure via
 * `page.evaluate` and re-measures containment — this proves the CSS geometry contract, not the
 * currency formatter (which has its own owning tests elsewhere).
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

    // FR-SFA-001 (Discover follow-up, 2026-09-28): the seed data is USD, but the layout must
    // also hold for the representative long IDR amount (trillions scale) a real org-currency
    // tenant renders. Substitute every stage's rendered amount with a deterministic id-ID/IDR
    // figure — the layout-only probe described in the file header — then re-measure containment.
    const idrProbeAmounts = await page.evaluate(() => {
      const idr = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(1_250_000_000_000);
      const texts: string[] = [];
      document.querySelectorAll('[data-funnel-stage-amount]').forEach((el) => {
        el.textContent = idr;
        texts.push(idr);
      });
      return texts;
    });
    expect(idrProbeAmounts).toHaveLength(5);

    // For every stage, the (now IDR-probed) amount's box must lie inside the stage's own box
    // (tolerance 1px).
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

  test('AC-SFA-001: keyboard focus scrolls a partly off-screen stage into the funnel viewport at 390px', async ({
    page,
  }) => {
    // Discover finding (2026-09-28): Tab to a stage past the visible edge of the 390px funnel
    // left it only partly shown. Focusing the LAST stage (the one most likely to sit beyond the
    // fold at phone width) must bring its whole box inside the scroll viewport's visible bounds.
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, 'admin@acme.test');
    await page.goto('/sales');
    await expect(page.locator('[data-funnel-stage]')).toHaveCount(5);

    const lastStage = page.locator('[data-funnel-stage]').last();
    // `.focus()` dispatches the same native `focus` event a real Tab keypress produces, without
    // depending on how many other elements precede it in the page's tab order.
    await lastStage.focus();

    const boxes = await page.evaluate(() => {
      const scrollArea = document.querySelector('[data-testid="funnel-scroll-area"]');
      const stages = document.querySelectorAll('[data-funnel-stage]');
      const lastStageEl = stages[stages.length - 1];
      return {
        scrollArea: scrollArea!.getBoundingClientRect().toJSON() as unknown as DOMRect,
        stage: lastStageEl.getBoundingClientRect().toJSON() as unknown as DOMRect,
      };
    });

    expect(
      boxes.stage.x,
      `focused stage starts before the scroll viewport: stage.x=${boxes.stage.x.toFixed(1)} < scrollArea.x=${boxes.scrollArea.x.toFixed(1)}`,
    ).toBeGreaterThanOrEqual(boxes.scrollArea.x - 1);
    expect(
      boxes.stage.x + boxes.stage.width,
      `focused stage extends past the scroll viewport: stage.right=${(boxes.stage.x + boxes.stage.width).toFixed(1)} > scrollArea.right=${(boxes.scrollArea.x + boxes.scrollArea.width).toFixed(1)}`,
    ).toBeLessThanOrEqual(boxes.scrollArea.x + boxes.scrollArea.width + 1);
  });
});