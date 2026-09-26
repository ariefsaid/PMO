// @e2e-isolation: read-only — desktop + 390px reachability/overflow/visibility sweep of the route-backed shell; seeded Admin session, no DB writes.
import { test, expect, type Page } from '@playwright/test';
import { signIn } from './helpers';

/**
 * AC-ADMIA-005 (rendered) — desktop and 390px phone oracle for the Administration shell (Plan Task 9).
 *
 * At desktop and at the 390px phone width, every organization Admin destination link must be
 * reachable (real, clickable, navigable), the selected panel must remain visible, and the page must
 * show no page-level horizontal overflow or clipped element running off the right edge. This is the
 * rendered counterpart to the shell's unit-level responsive/semantic assertions (Plan Task 8): a
 * jsdom test cannot measure real layout, so the "no horizontal page overflow" and "no element bleeds
 * past the viewport" properties are proven here in a real browser.
 *
 * ORACLE (mirrors AC-MOBILE-OVERFLOW-001): we do NOT gate page-scroll alone — the app `<main>` is
 * overflow-x-hidden so bleed would be clipped silently. We walk every visible element and fail if its
 * right edge exceeds the viewport, EXCLUDING legitimate horizontal scrollers (`overflow-x: auto|scroll`,
 * e.g. the wide budget-map table) and their descendants, AND we separately assert
 * `documentElement.scrollWidth <= viewport` so a scroller can never escape to the root and make the
 * whole page pan. Neither oracle subsumes the other.
 *
 * The shell renders in both light and dark modes, so at the phone width we repeat the sweep in dark
 * theme (the existing visual harness applies `.dark` via the `theme` localStorage key read at
 * bootstrap).
 */

const ADMIN = 'admin@acme.test';

// All four organization destinations an org Admin (non-Operator) can reach.
const ORGANIZATION_SECTIONS = [
  { name: 'Users', url: '/administration/users', testid: 'administration-panel-users', heading: 'Users' },
  {
    name: 'Organization integrations',
    url: '/administration/integrations',
    testid: 'administration-panel-integrations',
    heading: 'Organization integrations',
  },
  {
    name: 'Accounting setup',
    url: '/administration/accounting',
    testid: 'administration-panel-accounting',
    heading: 'Accounting setup',
  },
  { name: 'Credits', url: '/administration/credits', testid: 'administration-panel-credits', heading: 'Credits' },
] as const;

const sectionNav = (page: Page) => page.getByRole('navigation', { name: 'Administration sections' });

/** Returns elements whose right edge exceeds the viewport, excluding legitimate horizontal scrollers
 *  and their descendants. Runs in the page. */
async function findBleeders(page: Page, vw: number) {
  return page.evaluate((vw) => {
    const tol = 2;
    const inScroller = (el: Element): boolean => {
      let p = el.parentElement;
      while (p) {
        const ov = getComputedStyle(p).overflowX;
        if (ov === 'auto' || ov === 'scroll') return true;
        p = p.parentElement;
      }
      return false;
    };
    const out: { tag: string; cls: string; right: number; text: string }[] = [];
    document.querySelectorAll('body *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (r.right > vw + tol && !inScroller(el)) {
        out.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.getAttribute('class') ?? '').slice(0, 60),
          right: Math.round(r.right),
          text: (el.textContent ?? '').trim().slice(0, 30),
        });
      }
    });
    out.sort((a, b) => b.right - a.right);
    return out.slice(0, 12);
  }, vw);
}

/** The two complementary no-overflow oracles: no element bleeds past the viewport, and the page
 *  itself never pans horizontally. */
async function assertNoHorizontalOverflow(page: Page, vw: number) {
  const bleeders = await findBleeders(page, vw);
  expect(
    bleeders,
    `Horizontal bleed on Administration @${vw}px — elements past the viewport:\n` +
      bleeders.map((b) => `  ${b.right}px <${b.tag} class="${b.cls}"> "${b.text}"`).join('\n'),
  ).toEqual([]);

  const pageScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(
    pageScrollWidth,
    `The PAGE itself pans horizontally on Administration @${vw}px ` +
      `(documentElement.scrollWidth ${pageScrollWidth} > ${vw}). A horizontal scroller must contain ` +
      `its own overflow — the user must never be able to scroll the whole page sideways.`,
  ).toBeLessThanOrEqual(vw + 2);
}

async function driveSections(page: Page, vw: number, height: number) {
  // Every Admin destination link is reachable and navigates to a visible, overflow-free panel.
  for (const s of ORGANIZATION_SECTIONS) {
    const link = sectionNav(page).getByRole('link', { name: s.name });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${s.url}$`));
    await expect(page.getByTestId(s.testid)).toBeVisible();

    // Selected panel heading is visible; at phone widths it must also be within the first scroll region.
    const heading = page.getByRole('heading', { level: 1, name: 'Administration' });
    const panelHeading = page.getByRole('heading', { level: 2, name: s.heading });
    await expect(heading).toBeVisible();
    await expect(panelHeading).toBeVisible();
    if (vw < 600) {
      for (const el of [heading, sectionNav(page).getByRole('link', { name: s.name }), panelHeading]) {
        const box = await el.boundingBox();
        expect(box, `${s.name} control should have a layout box at ${vw}px`).not.toBeNull();
        expect(
          box!.y,
          `${s.name} control must sit within the first scroll region at ${vw}px — its top (${Math.round(
            box!.y,
          )}px) is below the ${height}px viewport.`,
        ).toBeLessThan(height);
      }
    }

    await assertNoHorizontalOverflow(page, vw);
  }
}

test('AC-ADMIA-005: Administration destinations stay reachable and overflow-free at desktop, phone, and phone dark mode', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, ADMIN);
  await page.goto('/administration');

  await driveSections(page, 1280, 800);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/administration');
  await driveSections(page, 390, 844);

  await page.evaluate(() => localStorage.setItem('theme', 'dark'));
  await page.goto('/administration');
  await expect(page.locator('html')).toHaveClass(/dark/);
  await driveSections(page, 390, 844);
});
