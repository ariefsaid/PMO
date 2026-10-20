// @e2e-isolation: read-only — the PM dashboard's Project Status rows keep every project name visible.
import { expect, test } from '@playwright/test';
import { signIn, waitForFonts } from './helpers';

for (const width of [1440, 1024, 390]) {
  test(`AC-1238-004: PM dashboard Project Status names keep a visible width at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page, 'pm@acme.test');
    await page.goto('/');
    await waitForFonts(page);

    const card = page.getByRole('region', { name: 'Project Status' });
    await expect(card).toBeVisible();
    const names = card.locator('ul li a[href^="/projects/"]');
    await expect(names.first()).toBeVisible();
    const widths = await names.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
    expect(widths.length).toBeGreaterThan(0);
    for (const w of widths) expect(w, 'project name element has real width').toBeGreaterThan(40);
  });
}
