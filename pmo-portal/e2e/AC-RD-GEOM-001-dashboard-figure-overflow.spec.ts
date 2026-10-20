// @e2e-isolation: read-only — navigates dashboards over route-mocked reads (IDR fixture) and measures rendered boxes; Bahasa is a route-rewritten profile read (no writes).
/**
 * AC-RD-GEOM-001 — dashboard figures never overflow their box, never cross their card, and the
 * page never pans sideways (ADR-0030 Layer-1 geometry gate; design pass RD-025 / RD-049).
 *
 * "Figure" = every visible `.tabular` element outside a table (DESIGN.md puts `.tabular` on every
 * figure that can change or be compared). Four oracles per route x width:
 *   1. figure.scrollWidth <= figure.clientWidth   (no clipped / ellipsised figure — D-007)
 *   2. the figure's box lies inside its nearest card (unless an intentional x-scroller owns it)
 *   3. a money figure never wraps mid-number: each figure text node renders on ONE line
 *   4. documentElement.scrollWidth <= clientWidth (no horizontal page overflow)
 *
 * Data: the client-shaped IDR-billions fixture (`dashboard-idr.fixtures.ts`) — the seed's small USD
 * figures fit any tile even unformatted, so they could never reproduce the bleed this gate guards.
 * Plus the win-rate card at 390px: the period control must end above the headline figure (D-006).
 *
 * Matrix: executive `/` (1440 / 1024 / 390, EN + Bahasa), Finance `/` (1440 / 1024 / 390, plus
 * Bahasa 1440), PM `/` (1440 / 1024 / 390), Sales pipeline `/sales` (1440 / 1024 / 390), Revenue by
 * project and Management pack (1440 / 390, plus Bahasa 1440). Later
 * real-data slices add their route to ROUTES so bleeding can't regress.
 *
 * Bahasa without a write: `I18nProvider` resolves the language only from the signed-in profile,
 * so the profile read is rewritten to `locale: 'id'` (same technique as UXS-006).
 */
import { expect, test, type Page } from '@playwright/test';
import { signIn, waitForFonts } from './helpers';
import { installIdrDashboardFixture } from './dashboard-idr.fixtures';

const WIDTHS = [1440, 1024, 390] as const;

async function forceBahasa(page: Page) {
  await page.route('**/rest/v1/profiles?*', async (route) => {
    const url = route.request().url();
    if (route.request().method() !== 'GET' || !/[?&]id=eq\./.test(url)) return route.fallback();
    const response = await route.fetch();
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return route.fulfill({ response });
    }
    if (body && !Array.isArray(body) && typeof body === 'object' && 'locale' in body) {
      body = { ...(body as Record<string, unknown>), locale: 'id', number_locale: 'id-ID' };
    }
    return route.fulfill({ response, json: body });
  });
}

interface Route {
  name: string;
  user: string;
  path: string;
  /** A locator-producing hook proving the dashboard has rendered its data. */
  ready: (page: Page) => ReturnType<Page['getByTestId']>;
  widths: readonly number[];
  bahasaWidths: readonly number[];
}

const ROUTES: Route[] = [
  { name: 'executive', user: 'exec@acme.test', path: '/', ready: (p) => p.getByTestId('kpi-total-spend').or(p.getByTestId('mobile-contract-book')), widths: WIDTHS, bahasaWidths: [1440, 390] },
  { name: 'finance', user: 'finance@acme.test', path: '/', ready: (p) => p.getByTestId('kpi-spend'), widths: WIDTHS, bahasaWidths: [1440] },
  { name: 'pm', user: 'pm@acme.test', path: '/', ready: (p) => p.getByTestId('kpi-my-contract-value'), widths: WIDTHS, bahasaWidths: [] },
  { name: 'sales pipeline', user: 'exec@acme.test', path: '/sales', ready: (p) => p.locator('main .tabular'), widths: WIDTHS, bahasaWidths: [] },
  { name: 'revenue by project', user: 'exec@acme.test', path: '/revenue-by-project', ready: (p) => p.locator('main .tabular'), widths: [1440, 390], bahasaWidths: [1440] },
  { name: 'management pack', user: 'exec@acme.test', path: '/reports', ready: (p) => p.locator('main .tabular'), widths: [1440, 390], bahasaWidths: [1440] },
];

/** A whole money/number figure ("IDR 160.9B", "Rp 160,9 M", "US$3,4 jt", "−$2.5K", "95.6%"). */
const FIGURE_TEXT = /^[−-]?(?:[A-Z]{3}|Rp|US\$|\$|€)?\s?[−-]?[\d.,]+\s?(?:[KMBT]|rb|jt)?%?$/u;

interface Violation { text: string; reason: string }

async function figureViolations(page: Page): Promise<Violation[]> {
  return page.evaluate((figureSource) => {
    const figureRe = new RegExp(figureSource, 'u');
    const out: { text: string; reason: string }[] = [];
    const scrollerOwns = (el: Element) => {
      for (let n: Element | null = el.parentElement; n; n = n.parentElement) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll') return true;
      }
      return false;
    };
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('.tabular'))) {
      if (el.closest('table, [role="table"], [role="grid"]')) continue;
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue; // hidden / inline-with-no-box
      const text = (el.textContent ?? '').trim().slice(0, 40);
      if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 0.5) {
        out.push({ text, reason: `clipped: scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}` });
      }
      // Oracle 3: `break-words` lets a too-long figure wrap instead of overflowing, which oracle 1
      // cannot see — so every whole-figure text node must lay out on a single line.
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const figureText = (node.textContent ?? '').trim();
        if (!figureRe.test(figureText)) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const tops = new Set(Array.from(range.getClientRects()).filter((r) => r.width > 0).map((r) => Math.round(r.top)));
        if (tops.size > 1) out.push({ text: figureText, reason: `wraps mid-number across ${tops.size} lines` });
      }
      if (scrollerOwns(el)) continue;
      const card = el.parentElement?.closest<HTMLElement>('[class*="rounded-lg"][class*="border"], [class*="rounded-md"][class*="border"]');
      if (card) {
        const c = card.getBoundingClientRect();
        if (box.right > c.right + 0.5 || box.left < c.left - 0.5) {
          out.push({ text, reason: `crosses its card: box ${Math.round(box.left)}-${Math.round(box.right)} vs card ${Math.round(c.left)}-${Math.round(c.right)}` });
        }
      }
    }
    return out;
  }, FIGURE_TEXT.source);
}

async function expectFiguresContained(page: Page, label: string) {
  await waitForFonts(page);
  const violations = await figureViolations(page);
  expect(violations, `${label}: every figure fits its own box and its card`).toEqual([]);
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(overflow.scroll, `${label}: no horizontal page overflow`).toBeLessThanOrEqual(overflow.client);
}

test.describe('AC-RD-GEOM-001: dashboard figures stay inside their boxes', () => {
  for (const route of ROUTES) {
    for (const width of route.widths) {
      test(`AC-RD-GEOM-001: ${route.name} dashboard at ${width}px (English)`, async ({ page }) => {
        await installIdrDashboardFixture(page);
        await page.setViewportSize({ width, height: 900 });
        await signIn(page, route.user);
        await page.goto(route.path);
        await expect(route.ready(page).first()).toBeVisible();
        await expectFiguresContained(page, `${route.name} ${width}px en`);
      });
    }
    for (const width of route.bahasaWidths) {
      test(`AC-RD-GEOM-001: ${route.name} dashboard at ${width}px (Bahasa)`, async ({ page }) => {
        await forceBahasa(page);
        await installIdrDashboardFixture(page);
        await page.setViewportSize({ width, height: 900 });
        await signIn(page, route.user);
        await page.goto(route.path);
        await expect(route.ready(page).first()).toBeVisible();
        await expectFiguresContained(page, `${route.name} ${width}px id`);
      });
    }
  }

  for (const bahasa of [false, true]) {
    test(`AC-RD-GEOM-001: win-rate period control ends above the headline figure at 390px (${bahasa ? 'Bahasa' : 'English'})`, async ({ page }) => {
      if (bahasa) await forceBahasa(page);
      await installIdrDashboardFixture(page);
      await page.setViewportSize({ width: 390, height: 900 });
      await signIn(page, 'exec@acme.test');
      await page.goto('/');
      const figure = page.getByTestId('kpi-win-rate');
      await expect(figure).toBeVisible();
      await waitForFonts(page);
      const gap = await figure.evaluate((el) => {
        const card = el.closest('section');
        const periods = card?.querySelector('[data-testid="win-rate-period-all"]')?.parentElement;
        if (!periods) throw new Error('win-rate period control not found');
        const track = periods.getBoundingClientRect();
        const lastButton = Array.from(periods.querySelectorAll('button')).reduce((bottom, b) => Math.max(bottom, b.getBoundingClientRect().bottom), 0);
        return { figureTop: el.getBoundingClientRect().top, trackBottom: track.bottom, buttonsBottom: lastButton };
      });
      expect(gap.buttonsBottom, 'every period option sits inside its track').toBeLessThanOrEqual(gap.trackBottom + 0.5);
      expect(gap.trackBottom, 'the track ends above the win-rate figure').toBeLessThanOrEqual(gap.figureTop + 0.5);
    });
  }
});
