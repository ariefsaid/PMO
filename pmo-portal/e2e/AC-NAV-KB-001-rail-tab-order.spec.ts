// @e2e-isolation: read-only — keyboard navigation only, seeded reader, no data writes.
import { test, expect } from '@playwright/test';
import { signIn, waitForFonts } from './helpers';

test('AC-NAV-KB-001: Tab through a short rail reaches every link in document order and scrolls each focused item fully into view', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.addInitScript(() => localStorage.removeItem('shell.navigation.collapsedGroups'));
  await signIn(page, 'exec@acme.test');
  await page.goto('/projects');
  const nav = page.getByRole('navigation', { name: 'Primary navigation' });
  const region = nav.locator('[data-rail-scroll-region]');
  await expect(region.locator('a[aria-current="page"]')).toBeVisible();
  await waitForFonts(page);
  // Include clipped links: they remain destinations a keyboard reader must reach.
  // Exclude only controls in genuinely collapsed/absent layout.
  const stops = await region.locator('a, button').evaluateAll(elements => elements.flatMap((element, index) => {
    const node = element as HTMLElement;
    return node.getClientRects().length && node.tabIndex >= 0 ? [{ index, href: node.getAttribute('href') }] : [];
  }));
  expect(stops.filter(stop => stop.href).length).toBeGreaterThan(10);
  await expect.poll(() => region.locator('a').evaluateAll(links => links.filter(link => getComputedStyle(link).opacity === '0').length)).toBeGreaterThan(0);
  await nav.locator('a[href="/approvals"]').focus();
  for (const stop of stops) {
    await page.keyboard.press('Tab');
    const destination = region.locator('a, button').nth(stop.index);
    await expect(destination).toBeFocused();
    await expect.poll(() => destination.evaluate(element => {
      const box = element.getBoundingClientRect();
      const viewport = element.closest('[data-rail-scroll-region]')!.getBoundingClientRect();
      return box.top >= viewport.top - 0.5 && box.bottom <= viewport.bottom + 0.5;
    })).toBe(true);
    await expect(destination).toHaveCSS('opacity', '1');
  }
});
