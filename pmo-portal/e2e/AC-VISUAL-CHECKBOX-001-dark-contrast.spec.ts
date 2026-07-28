// @e2e-isolation: read-only — public /privacy nav + a computed-style read; no DB reads/writes.
import { test, expect } from '@playwright/test';

/**
 * AC-VISUAL-CHECKBOX-001 (Discover-pass IMPORTANT-5): the checkbox's rendered (computed-style,
 * real browser, real cascade) border color must clear WCAG 1.4.11's 3:1 non-text-contrast floor
 * against its actual page background, in DARK theme, while the control is genuinely INTERACTIVE
 * (not `disabled` — WCAG 1.4.11 explicitly exempts disabled controls, and a disabled Checkbox is
 * intentionally dimmed via `opacity-45`, which is a different, exempt case).
 *
 * This is the RENDERED companion to the static token-math unit test
 * (`src/components/ui/__tests__/checkboxBorderContrast.test.ts`, `AC-A11Y-CHECKBOX-001`), which
 * only re-derives the ratio from `index.css`'s source text — it cannot catch a drift between the
 * token FILE and what Tailwind/the browser actually paints (a broken `border-input` utility
 * mapping, a stale build, etc.). Per ADR-0010 this is a distinct AC (its own layer, e2e) rather
 * than a second owner of AC-A11Y-CHECKBOX-001.
 *
 * Runs on the 'consent' project (port 3100, analytics genuinely enabled) so the checkbox renders
 * in its INTERACTIVE 'active' state — the default chromium e2e lane has no valid PostHog key, so
 * the toggle would always render `disabled` (dimmed) there, which is the WRONG state to measure.
 */

function parseRgb(value: string): [number, number, number] {
  const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(value);
  if (!m) throw new Error(`could not parse rgb() from computed style: "${value}"`);
  return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const srgb = [r, g, b].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

function contrastRatio(rgb1: [number, number, number], rgb2: [number, number, number]): number {
  const l1 = relativeLuminance(rgb1);
  const l2 = relativeLuminance(rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

test('AC-VISUAL-CHECKBOX-001: the dark-theme, interactive, unchecked checkbox border clears 3:1 against its real rendered background', async ({ page }) => {
  // Force dark BEFORE first paint (matches index.html's own no-flash bootstrap, which reads this
  // exact key) and ensure not-DNT / not-opted-out, so the toggle renders in its interactive
  // 'active' (undimmed) state.
  await page.addInitScript(() => {
    window.localStorage.setItem('theme', 'dark');
    window.localStorage.removeItem('pmo.analyticsOptOut');
  });
  await page.goto('/privacy');

  const box = page.getByRole('checkbox', { name: /usage analytics/i });
  await expect(box).not.toBeChecked(); // 'active' state renders unchecked — confirms we measured the right state
  await expect(box).not.toHaveAttribute('aria-disabled', 'true');

  const { borderColor, bgColor } = await box.evaluate((el) => {
    const cs = getComputedStyle(el as HTMLElement);
    // Walk up for the first ancestor with a non-transparent background — the real painted
    // backdrop this border sits against, not necessarily the element's own (transparent) parent.
    let node: HTMLElement | null = el as HTMLElement;
    let bg = 'rgba(0, 0, 0, 0)';
    while (node) {
      const c = getComputedStyle(node).backgroundColor;
      if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') {
        bg = c;
        break;
      }
      node = node.parentElement;
    }
    return { borderColor: cs.borderTopColor, bgColor: bg };
  });

  const ratio = contrastRatio(parseRgb(borderColor), parseRgb(bgColor));
  expect(ratio, `border ${borderColor} vs background ${bgColor} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3.0);
});
