// @e2e-isolation: read-only — asserts the project header strip geometry at 1024px; no writes.
import { expect, test } from '@playwright/test';
import { login, waitForFonts } from './helpers';

const projectPath = '/projects/41000000-0000-0000-0000-000000000001/overview';

for (const role of ['pm', 'finance'] as const) {
  test(`AC-RD-HDR-001: ${role} sees a compact header strip at 1024px — one details disclosure, every figure inside its tile, no horizontal bleed`, async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await login(page, `${role}@acme.test`);
    await page.goto(projectPath);
    await waitForFonts(page);

    const tiles = page.getByTestId('stat-tile');
    await expect(tiles.first()).toBeVisible();
    // Net fewer always-visible elements: the header's own disclosure is gone, the rail owns the codes.
    await expect(page.getByText('More project details', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('project-detail-rail').locator('summary')).toHaveCount(1);
    // No prose in a figure slot: every figure is a money amount, a percentage or an em dash.
    const count = await tiles.count();
    for (let i = 0; i < count; i++) {
      const value = tiles.nth(i).locator(':scope > div').nth(1);
      const visible = (await value.evaluate((el) => {
        const clone = el.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('.sr-only, button, [data-testid="fx-equivalent"]').forEach((n) => n.remove());
        return clone.textContent ?? '';
      })).trim();
      expect(visible, `tile ${i} value is a figure, not prose`).toMatch(/^(—|[^A-Za-z]*\d[\d.,%\s]*[^A-Za-z]*|[A-Z$€£]{1,4}\s?[\d.,\s]+)$/);
      const box = await tiles.nth(i).evaluate((el) => {
        const tile = el.getBoundingClientRect();
        const v = el.querySelector(':scope > div:nth-child(2)') as HTMLElement;
        return { overflow: v.scrollWidth - v.clientWidth, right: tile.right, vw: window.innerWidth };
      });
      expect(box.overflow, `tile ${i} figure fits its box`).toBeLessThanOrEqual(1);
      expect(box.right, `tile ${i} stays inside the viewport`).toBeLessThanOrEqual(box.vw + 0.5);
    }
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
