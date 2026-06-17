/**
 * AC-VISUAL-ICON-001 — no oversized shared icons.
 *
 * WHY THIS GATE EXISTS (2026-06-17 timesheet regression):
 * A classless `<Icon>` in the /timesheets toolbar rendered at its SVG intrinsic size
 * (~77px) instead of the intended ~16px because no CSS constrained it. The existing
 * AC-MOBILE-OVERFLOW-001 gate could NOT catch this: an oversized icon that sits inside
 * a container does not necessarily push content beyond the viewport right-edge (the
 * container clips or wraps). This gate catches it directly by measuring every shared
 * icon SVG on every route.
 *
 * ORACLE: every `svg[viewBox="0 0 24 24"]` (the shared Icon family — all app icons use
 * this viewBox) that is actually visible (non-zero size, not display:none) must have
 * getBoundingClientRect() width ≤ 40 AND height ≤ 40.  Standard icons render at
 * 13–24 px; 40 is a generous ceiling that flags the 77 px regression while leaving
 * room for intentionally large decorative uses up to that limit.
 *
 * EXCLUDES: recharts / other chart SVGs (they use different viewBoxes or no viewBox
 * at all — the selector `svg[viewBox="0 0 24 24"]` is specific to the Icon family).
 *
 * Complements AC-MOBILE-OVERFLOW-001 (layout bleed) — together they form the
 * deterministic structural visual-invariant layer-1 gate battery.
 */
import { test, expect, type Page } from '@playwright/test';
import { signIn } from './helpers';

// Stable seed id — supabase/seed.sql.
const MERIDIAN = '41000000-0000-0000-0000-000000000001';

const ROUTES: { path: string; label: string }[] = [
  { path: '/', label: 'dashboard' },
  { path: '/my-tasks', label: 'my-tasks' },
  { path: '/sales', label: 'sales-pipeline' },
  { path: '/projects', label: 'projects-list' },
  { path: `/projects/${MERIDIAN}/overview`, label: 'project-overview' },
  { path: `/projects/${MERIDIAN}/budget`, label: 'project-budget' },
  { path: `/projects/${MERIDIAN}/tasks`, label: 'project-tasks' },
  { path: '/procurement', label: 'procurement-list' },
  { path: '/timesheets', label: 'timesheets' },
  { path: '/approvals', label: 'approvals' },
  { path: '/companies', label: 'companies' },
  { path: '/contacts', label: 'contacts' },
  { path: '/administration', label: 'administration' },
];

const VIEWPORTS = [
  { width: 1280, height: 860, label: 'desktop' },
  { width: 390, height: 800, label: 'mobile' },
];

/** Max allowed dimension for a shared icon. Standard icons are 13–24 px; 40 is the
 *  generous ceiling. The 2026-06-17 regression rendered at 77 px → well above this. */
const MAX_ICON_SIZE = 40;

interface OversizedIcon {
  width: number;
  height: number;
  nearbyText: string;
  ariaLabel: string;
  classList: string;
}

/** Walk every `svg[viewBox="0 0 24 24"]` on the page. Skip invisible ones (size 0 or
 *  display:none). Return those whose rendered width or height exceeds MAX_ICON_SIZE. */
async function findOversizedIcons(page: Page, maxSize: number): Promise<OversizedIcon[]> {
  return page.evaluate((maxSize) => {
    const oversized: {
      width: number;
      height: number;
      nearbyText: string;
      ariaLabel: string;
      classList: string;
    }[] = [];

    document.querySelectorAll<SVGSVGElement>('svg[viewBox="0 0 24 24"]').forEach((svg) => {
      // Skip display:none elements.
      if (getComputedStyle(svg).display === 'none') return;

      const rect = svg.getBoundingClientRect();
      // Skip zero-size (hidden / not laid out / off-screen).
      if (rect.width === 0 && rect.height === 0) return;

      if (rect.width > maxSize || rect.height > maxSize) {
        // Find the nearest text for a debuggable failure message: look at parent chain.
        let nearbyText = '';
        let el: Element | null = svg.parentElement;
        for (let i = 0; i < 5 && el; i++) {
          const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
          if (t) { nearbyText = t; break; }
          el = el.parentElement;
        }

        oversized.push({
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          nearbyText,
          ariaLabel: svg.getAttribute('aria-label') ?? '',
          classList: (svg.getAttribute('class') ?? '').slice(0, 80),
        });
      }
    });

    return oversized;
  }, maxSize);
}

test.describe('AC-VISUAL-ICON-001 no oversized shared icons', () => {
  for (const vp of VIEWPORTS) {
    for (const route of ROUTES) {
      test(`AC-VISUAL-ICON-001 ${route.label} @${vp.label}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await signIn(page, 'admin@acme.test');
        await page.goto(route.path);

        // Let async data + charts settle so we measure steady-state rendered sizes.
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1500);

        const oversized = await findOversizedIcons(page, MAX_ICON_SIZE);

        expect(
          oversized,
          `Oversized icon(s) on ${route.path} @${vp.width}×${vp.height} — ` +
            `icons exceeding ${MAX_ICON_SIZE}px:\n` +
            oversized
              .map(
                (ic) =>
                  `  ${ic.width}×${ic.height}px  class="${ic.classList}"` +
                  (ic.ariaLabel ? `  aria-label="${ic.ariaLabel}"` : '') +
                  (ic.nearbyText ? `  near: "${ic.nearbyText}"` : ''),
              )
              .join('\n'),
        ).toEqual([]);
      });
    }
  }
});
