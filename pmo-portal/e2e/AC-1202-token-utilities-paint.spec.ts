import { test, expect } from '@playwright/test';
import { login } from './helpers';

// AC-1202 — Token utilities actually PAINT (Tailwind v4 @theme pipeline guard).
//
// The C1 token pipeline bug: index.css `@theme inline` mapped every `--color-*`
// with the v3 `<alpha-value>` placeholder, which Tailwind v4 does NOT substitute
// — the compiled CSS emitted `color: hsl(var(--primary) / <alpha-value>)`, an
// invalid declaration the browser discards. Every `bg-*`/`text-*`/`border-*`
// token utility then rendered NOTHING. Unit tests asserted class NAMES and so
// were blind to it. This guard asserts the COMPUTED paint in a real browser, so
// a regression (re-adding `<alpha-value>`, or a broken token map) fails CI's
// integration job. Runs after login on the dashboard, where the active nav item
// uses `bg-primary/10 text-primary` and the ⌘K palette pre-selects an option
// styled `bg-primary/10`.

// A computed paint is "invisible" only if it is fully transparent. Chromium
// reports color-mix() output as oklab(... / <alpha>) and solid colors as
// rgb()/rgba(); the only no-paint sentinels are `transparent`, `rgba(0,0,0,0)`,
// and any function with a literal `/ 0` alpha. We treat everything else (incl.
// the `/ 0.1` tint) as a real paint — which is exactly what the bug killed.
function isInvisible(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v === 'transparent' || v === 'rgba(0, 0, 0, 0)') return true;
  // explicit zero alpha in any color function: `... / 0)` or trailing `, 0)`.
  if (/\/\s*0\s*\)$/.test(v)) return true;
  if (/,\s*0\s*\)$/.test(v)) return true;
  return false;
}

/**
 * Paint a 1px swatch of the given CSS color on a canvas and read back the
 * actual RGB the browser rasterizes — format-agnostic (rgb/oklab/color-mix).
 * Lets us assert the *hue* of `text-primary` without parsing every color space.
 */
async function rasterize(
  page: import('@playwright/test').Page,
  cssColor: string
): Promise<[number, number, number, number]> {
  return page.evaluate((color) => {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a];
  }, cssColor);
}

test('AC-1202 token utilities paint: active nav has a blue tint + blue text, ⌘K selection is highlighted', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page, 'exec@acme.test');
  await page.goto('/');

  // --- Active nav item: bg-primary/10 + text-primary must actually render. ---
  const activeNav = page
    .locator('aside[aria-label="Primary navigation"] nav a[aria-current="page"]')
    .first();
  await expect(activeNav).toBeVisible();

  const navStyle = await activeNav.evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, color: s.color };
  });

  // The bg-primary/10 wash must paint a non-transparent tint (not rgba(0,0,0,0),
  // not the discarded `hsl(... / <alpha-value>)` which falls back to no paint).
  expect(
    isInvisible(navStyle.bg),
    `active nav background should be a visible tint, got ${navStyle.bg}`
  ).toBe(false);

  // text-primary must be the brand blue (#3b82f6-ish: blue-dominant), NOT the
  // near-black foreground hsl(240 10% 3.9%) ≈ rgb(9,9,11). Rasterize to compare
  // hue regardless of the computed color space the browser reports.
  const [r, g, b] = await rasterize(page, navStyle.color);
  expect(b, `active nav text should be blue-dominant, got ${navStyle.color}`).toBeGreaterThan(150);
  expect(b, `active nav text blue channel should exceed red, got ${navStyle.color}`).toBeGreaterThan(r);
  expect(b, `active nav text blue channel should exceed green, got ${navStyle.color}`).toBeGreaterThan(g);

  // --- ⌘K command palette: the pre-selected option carries bg-primary/10. ---
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  const selected = page.locator('[role="option"][aria-selected="true"]').first();
  await expect(selected).toBeVisible();
  const selBg = await selected.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(
    isInvisible(selBg),
    `⌘K selected option should show the bg-primary/10 highlight, got ${selBg}`
  ).toBe(false);
});
