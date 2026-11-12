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
 * Matrix: executive `/` (1440 / 1024 / 390, EN + Bahasa), Finance `/finance` (1440 / 1024 / 390, plus
 * Bahasa 1440), PM `/` (1440 / 1024 / 390), Sales pipeline `/sales` (1440 / 1024 / 390), Revenue by
 * project and Management pack (1440 / 390, plus Bahasa 1440). Later
 * real-data slices add their route to ROUTES so bleeding can't regress.
 *
 * Bahasa without a write: `I18nProvider` resolves the language only from the signed-in profile,
 * so the profile read is rewritten to `locale: 'id'` (same technique as UXS-006).
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { openAppPath, signIn } from '../helpers';
import { expectFiguresContained } from './layout-oracles';
import { FINANCE_FIXTURE, installIdrDashboardFixture } from '../dashboard-idr.fixtures';

// Multi-step journey; measured at ~80% of the 30s default in CI.
test.setTimeout(60_000);

const WIDTHS = [1440, 1024, 390] as const;

async function forceBahasa(page: Page) {
  await page.route('**/rest/v1/profiles?*', async (route) => {
    const url = route.request().url();
    if (route.request().method() !== 'GET' || !/[?&]id=eq\./.test(url)) return route.fallback();
    const response = await route.fetch({ maxRetries: 2 });
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
  /** Loaded, independently fetched figures to wait for before measuring. */
  ready: (page: Page, width: number, language: 'en' | 'id') => Promise<void>;
  widths: readonly number[];
  bahasaWidths: readonly number[];
}

// The fixture-backed figures themselves, rather than their skeleton-bearing containers, are
// readiness signals. The sales phone layout renders deal cards instead of the desktop funnel.
// The exact title binds readiness to the actual IDR read fixture, not merely any long number.
const exactIdr = (value: number, language: 'en' | 'id') => new Intl.NumberFormat(
  language === 'id' ? 'id-ID' : 'en-US',
  { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 },
).format(value);
async function expectFixtureAmount(figure: Locator, amount: number, language: 'en' | 'id') {
  await expect(figure).toBeVisible();
  await expect(figure.locator('[title]')).toHaveAttribute('title', exactIdr(amount, language));
}
const companyReady: Route['ready'] = async (page, _width, language) => {
  const company = page.getByRole('region', { name: language === 'id' ? 'Angka perusahaan' : 'Company figures' });
  await expect(company.locator('.tabular').filter({ hasText: /373[.,]5/ }).first()).toBeVisible({ timeout: 20_000 });
  // The Sales card carries the weighted pipeline; the win rate and billing sit in the Analysis disclosure,
  // opened here so their figures stay inside the geometry gate.
  const weighted = page.getByText(language === 'id' ? 'Pipeline terbobot' : 'Weighted pipeline', { exact: true }).locator('xpath=..');
  await expect(weighted.locator('.tabular').filter({ hasText: /75[.,]2/ }).first()).toBeVisible();
  const analysis = page.getByText(language === 'id' ? 'Analisis' : 'Analysis', { exact: true });
  if (await analysis.isVisible().catch(() => false)) await analysis.click();
  await expect(page.getByTestId('kpi-win-rate')).toHaveText(/95(?:[.,]0)?%/);
};
const financeReady: Route['ready'] = async (page, _width, language) => {
  const areas = page.getByRole('region', { name: language === 'id' ? 'Area keuangan' : 'Finance areas' });
  // ux/1110 recomposed the hub's area cards into one KPI row: each area is a whole-surface link
  // ("Open Receivables") whose tile carries the figure in `.tabular` with the exact amount as the
  // figure's title. The three doorway figures are the readiness signal; the statement tile is
  // deliberately hidden (the IDR fixture answers `statement.unpublished`, so the page reports it in
  // the "N figures hidden" line instead of drawing a tile).
  for (const [href, amount] of [
    ['/finance/receivables', FINANCE_FIXTURE.receivable],
    ['/finance/payables', FINANCE_FIXTURE.payable],
    ['/finance/reports', FINANCE_FIXTURE.contract - FINANCE_FIXTURE.receivable],
  ] as const) {
    const tile = areas.locator(`a[href="${href}"]`).locator('xpath=..');
    await expect(tile.getByRole('status')).toHaveCount(0);
    await expectFixtureAmount(tile.locator('.tabular').first(), amount, language);
  }
  await expect(areas.locator('.tabular')).toHaveCount(3);
  // The statement tile is deliberately absent (the IDR fixture answers `statement.unpublished`);
  // the page says so once, in its hidden-figures line, instead of drawing an empty tile.
  await expect(page.getByTestId('figures-hidden').first()).toContainText(
    language === 'id' ? /angka disembunyikan/ : /figure hidden/,
  );
};
const reportReady: Route['ready'] = async (page, _width, language) => {
  const figures = page.getByRole('region', { name: language === 'id' ? 'Angka laporan' : 'Report figures' });
  await expect(figures.getByTestId('kpi-skeleton')).toHaveCount(0);
  // ux/1110 flattened the per-currency figure groups into one tile row: "Earned to date" carries the
  // contract total (the fixture recognises 100% of it) with the exact amount as the figure's title.
  const earned = figures
    .getByText(language === 'id' ? 'Pendapatan sampai saat ini' : 'Earned to date', { exact: true })
    .locator('xpath=../..');
  await expectFixtureAmount(earned.locator('.tabular').first(), FINANCE_FIXTURE.contract, language);
};
const ROUTES: Route[] = [
  { name: 'executive', user: 'exec@acme.test', path: '/', ready: companyReady, widths: WIDTHS, bahasaWidths: [1440, 390] },
  { name: 'finance', user: 'finance@acme.test', path: '/finance', ready: financeReady, widths: WIDTHS, bahasaWidths: [1440] },
  { name: 'pm', user: 'pm@acme.test', path: '/', ready: async (p) => { await expect(p.getByTestId('kpi-my-contract-value').locator('.tabular').filter({ hasText: /161B/ })).toBeVisible(); }, widths: WIDTHS, bahasaWidths: [] },
  { name: 'revenue by project', user: 'exec@acme.test', path: '/revenue-by-project', ready: reportReady, widths: [1440, 390], bahasaWidths: [1440] },
  { name: 'management pack', user: 'exec@acme.test', path: '/reports', ready: reportReady, widths: [1440, 390], bahasaWidths: [1440] },
  // Phase 2 (#1529): the sales pipeline route joins the matrix — the weighted total is the loaded,
  // independently fetched figure; at 390px the phone layout renders deal cards, so readiness binds
  // to the phone card's full amount instead of the desktop weighted-total testid.
  { name: 'sales pipeline', user: 'exec@acme.test', path: '/sales', ready: async (p, width) => {
    // ux/1110 reformats the funnel figures as compact tile money (formatTileMoney, 3 significant
    // digits) with the exact amount as the figure's title (T5, the home-tile contract): the weighted
    // total of the IDR fixture, 75,185,000,000, renders as "IDR 75.2B" on the desktop tiles. The
    // 390px phone layout keeps the full amount on the card.
    const figure = width === 390 ? p.locator('main .tabular').filter({ hasText: /5,457,143,000/ }).first() : p.getByTestId('pipeline-weighted-total');
    await expect(figure).toContainText(width === 390 ? /5,457,143,000/ : /75\.2B/);
    await expect(figure).toBeVisible();
  }, widths: WIDTHS, bahasaWidths: [] },
];

export function registerFigureLayout(name: string) {
 test.describe('AC-RD-GEOM-001: dashboard figures stay inside their boxes', () => {
  for (const route of ROUTES.filter((candidate) => candidate.name === name)) {
    for (const width of route.widths) {
      test(`@layout ${name === 'executive' && width === 1440 ? 'UIP-002 ' : ''}AC-RD-GEOM-001: ${route.name} dashboard at ${width}px (English)`, async ({ page }) => {
        await installIdrDashboardFixture(page);
        await page.setViewportSize({ width, height: 900 });
        await signIn(page, route.user);
        await openAppPath(page, route.path);
        await expect(page.locator('html')).toHaveAttribute('lang', 'en');
        await route.ready(page, width, 'en');
        await expectFiguresContained(page, `${route.name} ${width}px en`);
      });
    }
    for (const width of route.bahasaWidths) {
      test(`@layout AC-RD-GEOM-001: ${route.name} dashboard at ${width}px (Bahasa)`, async ({ page }) => {
        await forceBahasa(page);
        await installIdrDashboardFixture(page);
        await page.setViewportSize({ width, height: 900 });
        await signIn(page, route.user);
        await openAppPath(page, route.path);
        await expect(page.locator('html')).toHaveAttribute('lang', 'id');
        await route.ready(page, width, 'id');
        await expectFiguresContained(page, `${route.name} ${width}px id`);
      });
    }
  }


});
}
