// @e2e-isolation: read-only — the PM delivery worklist keeps every project name reachable and readable.
import { expect, test } from '@playwright/test';
import { signIn, waitForFonts } from './helpers';

for (const width of [1440, 1024, 390]) {
  test(`AC-1238-004: PM delivery worklist names keep a visible width at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page, 'pm@acme.test');
    await page.goto('/');
    await waitForFonts(page);

    const card = page.getByRole('region', { name: 'My delivery projects' });
    await expect(card).toBeVisible();
    const names = card.locator('[data-row] a[href^="/projects/"]');
    await expect(names.first()).toBeVisible();
    const widths = await names.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
    expect(widths.length).toBeGreaterThan(0);
    for (const w of widths) expect(w, 'project name element has real width').toBeGreaterThan(40);
  });
}
