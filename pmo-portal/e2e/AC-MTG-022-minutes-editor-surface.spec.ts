// @e2e-isolation: read-only — signIn + open the seeded meeting + type into the editor WITHOUT saving (no DB writes).
import { test, expect } from '@playwright/test';
import { signIn, waitForFonts } from './helpers';

/**
 * AC-MTG-022 / AC-MTG-021 (#805): the BlockNote minutes surface lands on DESIGN.md's heading scale
 * (24 / 20 / 18 px, not BlockNote's 3em / 2em / 1.3em) and never bleeds horizontally — including with
 * long unbroken strings, which the spike clipped mid-word at 375px. The a11y tree cannot express either
 * fact, so this measures the rendered boxes. Dark mode is checked too: the scale must not move with the
 * theme. Nothing is saved, so the shared seeded meeting is left untouched.
 */
const SEEDED_MEETING = 'ee000000-0000-0000-0000-000000000001';

for (const width of [390, 360]) {
  test(`AC-MTG-022: headings measure 24/20/18px and nothing bleeds at ${width}px (light + dark)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await signIn(page, 'pm@acme.test'); // the seeded author — sees the editable editor
    await page.goto(`/meetings/${SEEDED_MEETING}`);
    const editor = page.getByTestId('minutes-blocknote').locator('.bn-editor');
    await expect(editor).toBeVisible();
    await waitForFonts(page); // layout is measured below (#713)

    // BlockNote's markdown input rules: "# " / "## " / "### " at the start of an empty block.
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('# Page title');
    await page.keyboard.press('Enter');
    await page.keyboard.type('## Section heading');
    await page.keyboard.press('Enter');
    await page.keyboard.type('### Subheading');
    await page.keyboard.press('Enter');
    // A 160-char unbroken string — the class that bled at 375px in the spike.
    await page.keyboard.type(`https://example.test/${'x'.repeat(140)}`);

    // BlockNote omits data-level for H1 (the default level); H2/H3 carry it.
    const size = (level: number) =>
      editor
        .locator(
          level === 1
            ? '[data-content-type="heading"]:not([data-level])'
            : `[data-content-type="heading"][data-level="${level}"]`,
        )
        .last()
        .evaluate((el) => getComputedStyle(el).fontSize);

    for (const scheme of ['light', 'dark'] as const) {
      await page.evaluate((s) => {
        document.documentElement.classList.toggle('dark', s === 'dark');
        window.dispatchEvent(new Event('themechange'));
      }, scheme);
      expect(await size(1), `${scheme} H1`).toBe('24px');
      expect(await size(2), `${scheme} H2`).toBe('20px');
      expect(await size(3), `${scheme} H3`).toBe('18px');

      // AC-MTG-021: no element's right edge exceeds the viewport.
      const bleed = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        return {
          scroll: document.documentElement.scrollWidth - vw,
          worst: Math.max(
            0,
            ...Array.from(document.querySelectorAll('.minutes-editor *')).map(
              (el) => el.getBoundingClientRect().right - vw,
            ),
          ),
        };
      });
      expect(bleed.scroll, `${scheme}: page scroll width`).toBeLessThanOrEqual(0);
      expect(bleed.worst, `${scheme}: widest editor element`).toBeLessThanOrEqual(1);
    }
  });
}

/**
 * The add-block "+" / drag handle (BlockNote's side menu, 52px wide) is placed to the LEFT of a block, outside
 * the editor's own box: it used to cross the sidebar edge on desktop and sit at x<0 on a phone. The editor now
 * reserves its own inline-start room for it (>=640px) and does not offer the hover-only menu below that.
 * Measured on the rendered boxes — the a11y tree cannot see a clipped handle.
 */
for (const width of [1280, 390]) {
  test(`AC-MTG-022: the add-block handle stays inside the minutes content area at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await signIn(page, 'pm@acme.test');
    await page.goto(`/meetings/${SEEDED_MEETING}`);
    const surface = page.getByTestId('minutes-blocknote');
    await expect(surface.locator('.bn-editor')).toBeVisible();
    await waitForFonts(page);

    await surface.locator('.bn-block-content').first().hover();
    const handle = surface.locator('.bn-side-menu');
    if (width >= 640) {
      await expect(handle).toBeVisible();
      const [h, area] = await Promise.all([handle.boundingBox(), surface.boundingBox()]);
      expect(h, 'handle box').not.toBeNull();
      expect(area, 'content area box').not.toBeNull();
      // inside the content area (not over the sidebar), and inside the viewport
      expect(h!.x, 'handle left edge').toBeGreaterThanOrEqual(area!.x - 0.5);
      expect(h!.x + h!.width, 'handle right edge').toBeLessThanOrEqual(area!.x + area!.width + 0.5);
      expect(h!.x, 'handle is not clipped at x<0').toBeGreaterThanOrEqual(0);
    } else {
      // Below 640px the hover-only menu is not offered, so nothing can be clipped off the left edge.
      await expect(handle).toBeHidden();
    }

    // Either way: no element of the editor surface starts left of the viewport.
    const worstLeft = await page.evaluate(() =>
      Math.min(
        0,
        ...Array.from(document.querySelectorAll('.minutes-editor *'))
          .filter((el) => getComputedStyle(el).display !== 'none')
          .map((el) => el.getBoundingClientRect().left),
      ),
    );
    expect(worstLeft, 'leftmost editor element').toBeGreaterThanOrEqual(-0.5);
  });
}
