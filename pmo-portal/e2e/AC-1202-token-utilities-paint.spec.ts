// @e2e-isolation: read-only — pure nav/assert; asserts computed CSS token paints via login + navigation; no DB writes.
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
// integration job. Token swatches are independent of shell composition; the
// journey also preserves accessible current-destination and selected-option state.

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

test('AC-1202 token utilities paint and accessible navigation state', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page, 'exec@acme.test');
  await page.goto('/');

  const swatchPaints = await page.evaluate(() => {
    const alpha = document.createElement('span');
    alpha.className = 'bg-primary/10';
    const solid = document.createElement('span');
    solid.className = 'text-primary';
    document.body.append(alpha, solid);
    const paints = [getComputedStyle(alpha).backgroundColor, getComputedStyle(solid).color];
    alpha.remove();
    solid.remove();
    return paints;
  });
  for (const paint of swatchPaints) {
    expect(isInvisible(paint), `token swatch should paint, got ${paint}`).toBe(false);
  }

  const activeDestinations = page.locator('nav[aria-label="Primary navigation"] a[aria-current="page"]');
  await expect(activeDestinations).toHaveCount(1);
  await expect(activeDestinations.first()).toHaveAttribute('href', '/');

  // --- ⌘K command palette exposes the active selection semantically. ---
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  const selected = page.locator('[role="option"][aria-selected="true"]').first();
  await expect(selected).toBeVisible();
});
