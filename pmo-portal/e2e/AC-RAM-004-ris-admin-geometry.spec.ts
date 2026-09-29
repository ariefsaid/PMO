// @e2e-isolation: read-only — signs in the seed Admin and measures rendered geometry on two
// RIS-Admin surfaces (the pipeline-lens stage journey, the delivery-lens milestone strip). No
// DB writes.
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

/**
 * AC-RAM-004 (#688) Discover-pass follow-ups (2026-09-29) — two rendered-geometry gaps found
 * AFTER the axe pass went clean, neither of which `axe-core` itself catches:
 *
 * 1. `LifecycleStepper`'s bar-variant scroll viewport (`role=group`, `tabIndex=0`, added for
 *    `scrollable-region-focusable`) drew its `:focus-visible` ring OUTWARD from its own border
 *    box, but the viewport's own parent (`data-testid="stepper-clip-wrapper"`) is
 *    `overflow-hidden` — the exact class of clipping bug `AC-SFA-007` found on the Sales
 *    funnel. Fixed with a negative `outline-offset` (ring drawn INWARD instead).
 * 2. `MilestonePhaseHeader`'s stepper-variant name column had no wrap rule, so a long,
 *    unbroken milestone name (the seeded "Commissioning & Grid Connection", SP-2401 delivery
 *    lens) could render UNDER the `shrink-0` percentage column beside it once the milestone
 *    card grid narrowed to 4 columns (`xl:grid-cols-4`, `>=1280px`). Fixed with `break-words`
 *    on the name plus a reserved `min-w-[44px]` on the percentage column.
 *
 * Both are geometry the jsdom/RTL layer cannot see — Playwright against the real renderer is
 * the lowest sufficient layer (ADR-0010).
 */

const ADMIN = 'admin@acme.test';
/** P011 "Highfield Bridge Survey" — a pre-win seed row (pipeline lens), read only. */
const PIPELINE_LENS = '40000000-0000-0000-0000-000000000011';
/** SP-2401 "Meridian Steelworks 4.2 MW Rooftop PV" — an on-hand seed row (delivery lens), read only. */
const DELIVERY_LENS = '41000000-0000-0000-0000-000000000001';

test.describe('AC-RAM-004 geometry: LifecycleStepper focus ring is not clipped', () => {
  for (const viewport of [
    { label: '390', width: 390, height: 844 },
    { label: '1440', width: 1440, height: 900 },
  ]) {
    test(`AC-RAM-004 the stage-journey stepper's focus ring is not clipped by its overflow-hidden wrapper at ${viewport.label}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await signIn(page, ADMIN);
      await page.goto(`/projects/${PIPELINE_LENS}`);
      await expect(page.getByLabel('Project stage journey')).toBeVisible({ timeout: 20_000 });

      const scrollContainer = page.getByTestId('stepper-scroll-container');
      await scrollContainer.focus();

      const result = await page.evaluate(() => {
        const wrapper = document.querySelector('[data-testid="stepper-clip-wrapper"]')!;
        const region = document.querySelector('[data-testid="stepper-scroll-container"]') as HTMLElement;
        const cs = getComputedStyle(region);
        const outlineWidth = parseFloat(cs.outlineWidth) || 0;
        const outlineOffset = parseFloat(cs.outlineOffset) || 0;
        const grow = outlineOffset + outlineWidth;
        const regionRect = region.getBoundingClientRect();
        return {
          outlineStyle: cs.outlineStyle,
          outlineWidth,
          ring: {
            top: regionRect.top - grow,
            bottom: regionRect.bottom + grow,
            left: regionRect.left - grow,
            right: regionRect.right + grow,
          },
          wrapperRect: wrapper.getBoundingClientRect().toJSON() as unknown as DOMRect,
        };
      });

      expect(result.outlineStyle, 'the stepper scroll region shows no visible focus outline when focused').not.toBe('none');
      expect(result.outlineWidth, 'the stepper scroll region has a 0px outline width while focused').toBeGreaterThan(0);

      const { ring, wrapperRect } = result;
      expect(
        ring.top,
        `focus ring top (${ring.top.toFixed(1)}) is clipped above the wrapper (${wrapperRect.top.toFixed(1)})`,
      ).toBeGreaterThanOrEqual(wrapperRect.top - 1);
      expect(
        ring.bottom,
        `focus ring bottom (${ring.bottom.toFixed(1)}) is clipped below the wrapper (${(wrapperRect.top + wrapperRect.height).toFixed(1)})`,
      ).toBeLessThanOrEqual(wrapperRect.top + wrapperRect.height + 1);
      expect(
        ring.left,
        `focus ring left (${ring.left.toFixed(1)}) is clipped left of the wrapper (${wrapperRect.left.toFixed(1)})`,
      ).toBeGreaterThanOrEqual(wrapperRect.left - 1);
      expect(
        ring.right,
        `focus ring right (${ring.right.toFixed(1)}) is clipped right of the wrapper (${(wrapperRect.left + wrapperRect.width).toFixed(1)})`,
      ).toBeLessThanOrEqual(wrapperRect.left + wrapperRect.width + 1);
    });
  }
});

test.describe('AC-RAM-004 geometry: milestone percentage never overlaps the phase name', () => {
  for (const viewport of [
    { label: '1280', width: 1280, height: 900 },
    { label: '1440', width: 1440, height: 900 },
  ]) {
    test(`AC-RAM-004 the milestone card percentage stays clear of a long phase name at ${viewport.label}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await signIn(page, ADMIN);
      await page.goto(`/projects/${DELIVERY_LENS}/overview`);
      await expect(page.getByTestId('milestone-card-grid')).toBeVisible({ timeout: 20_000 });

      // The seeded "Commissioning & Grid Connection" phase is the long-name worst case at the
      // 4-column desktop card width (`xl:grid-cols-4`, >=1280px).
      const card = page
        .getByTestId('milestone-card-grid')
        .locator('section')
        .filter({ hasText: 'Commissioning & Grid Connection' });
      await expect(card).toBeVisible();

      const nameBox = await card.getByTestId('milestone-phase-name').boundingBox();
      const pctBox = await card.getByTestId('milestone-phase-pct').boundingBox();
      expect(nameBox, 'milestone phase name did not render a bounding box').not.toBeNull();
      expect(pctBox, 'milestone phase percentage did not render a bounding box').not.toBeNull();

      // The pct column sits to the right of the name column; they must never overlap
      // horizontally, and they must not overlap vertically at the same time (either is
      // sufficient to prove no visual collision).
      const nameRight = nameBox!.x + nameBox!.width;
      const pctLeft = pctBox!.x;
      const horizontallyClear = nameRight <= pctLeft + 1;
      const nameBottom = nameBox!.y + nameBox!.height;
      const pctTop = pctBox!.y;
      const pctBottom = pctBox!.y + pctBox!.height;
      const verticallyClear = nameBottom <= pctTop + 1 || nameBox!.y >= pctBottom - 1;

      expect(
        horizontallyClear || verticallyClear,
        `phase name box (right=${nameRight.toFixed(1)}, y=${nameBox!.y.toFixed(1)}..${nameBottom.toFixed(1)}) overlaps the percentage box (left=${pctLeft.toFixed(1)}, y=${pctTop.toFixed(1)}..${pctBottom.toFixed(1)})`,
      ).toBe(true);
    });
  }
});
