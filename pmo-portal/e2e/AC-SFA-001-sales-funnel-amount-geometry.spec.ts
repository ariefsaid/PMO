// @e2e-isolation: read-only — reads the seeded Sales Pipeline and measures rendered boxes; no writes.
/**
 * AC-SFA-005 — keyboard focus keeps the selected stage inside the funnel viewport at 768px.
 *
 * Discover finding (2026-09-28): Tab to a stage past the visible edge of the funnel left it only
 * partly shown. Phase 2 (#1529) moved the geometry rows (AC-SFA-001 amounts, AC-SFA-006 bar gap,
 * AC-SFA-007 focus rings) to the /sales layout sweep (e2e/layout/sales.layout.spec.ts).
 *
 * This test is the DOWN lane's MOVE-COMPONENT row (target:
 * pmo-portal/src/components/ui/__tests__/Funnel.focusScroll.test.tsx) and stays in the browser
 * until that lane moves it below the browser.
 */
import { test, expect } from '@playwright/test';
import { signIn, waitForFonts } from './helpers';

const FUNNEL_VIEWPORT_WIDTH = 768;

test.describe('AC-SFA-001 sales funnel amount geometry at the 768px desktop breakpoint', () => {
  test('AC-SFA-005: keyboard focus scrolls a partly off-screen stage into the funnel viewport at 768px', async ({
    page,
  }) => {
    await page.setViewportSize({ width: FUNNEL_VIEWPORT_WIDTH, height: 844 });
    await signIn(page, 'admin@acme.test');
    await page.goto('/sales');
    await expect(page.locator('[data-funnel-stage]')).toHaveCount(5);
    await waitForFonts(page);

    // Compact stages fit the panel; keyboard focus must still reveal the whole last stage.
    await page.locator('[data-funnel-stage]').first().focus();
    for (let i = 1; i < 5; i++) await page.keyboard.press('Tab');
    await expect(page.locator('[data-funnel-stage]').last()).toBeFocused();

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
