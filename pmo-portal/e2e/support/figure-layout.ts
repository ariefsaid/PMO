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
import { signIn } from '../helpers';
import { expectFiguresContained } from './layout-oracles';
import { FINANCE_FIXTURE, installIdrDashboardFixture } from '../dashboard-idr.fixtures';

// Multi-step journey; measured at ~80% of the 30s default in CI.
test.setTimeout(60_000);

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
const shortIdr = (value: number, language: 'en' | 'id') => new Intl.NumberFormat(
  language === 'id' ? 'id-ID' : 'en-US',
  { style: 'currency', currency: 'IDR', notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 1 },
).format(value);
async function expectFixtureAmount(figure: Locator, amount: number, language: 'en' | 'id') {
  await expect(figure).toBeVisible();
  await expect(figure.locator('[title]')).toHaveAttribute('title', exactIdr(amount, language));
}
const companyReady: Route['ready'] = async (page, _width, language) => {
  const company = page.getByRole('region', { name: language === 'id' ? 'Angka perusahaan' : 'Company figures' });
  await expect(company.locator('.tabular').filter({ hasText: /373[.,]5/ }).first()).toBeVisible();
  const sales = page.getByRole('region', { name: language === 'id' ? 'Kinerja penjualan' : 'Sales performance' });
  await expect(sales.locator('.tabular').filter({ hasText: /212[.,]6/ }).first()).toBeVisible();
  await expect(page.getByTestId('kpi-win-rate')).toHaveText(/95(?:[.,]0)?%/);
  const billing = page.getByRole('region', { name: language === 'id' ? 'Posisi penagihan' : 'Billing position' });
  await expect(billing.locator('.tabular').first()).toHaveText(shortIdr(FINANCE_FIXTURE.receivable, language));
};
const financeReady: Route['ready'] = async (page, _width, language) => {
  const areas = page.getByRole('region', { name: language === 'id' ? 'Area keuangan' : 'Finance areas' });
  for (const [href, minimum] of [
    ['/finance/receivables', FINANCE_FIXTURE.receivable],
    ['/finance/payables', FINANCE_FIXTURE.payable],
    ['/finance/reports', FINANCE_FIXTURE.contract - FINANCE_FIXTURE.receivable],
  ] as const) {
    const area = areas.locator('article').filter({ has: page.locator(`a[href="${href}"]`) });
    await expect(area.getByRole('status')).toHaveCount(0);
    await expectFixtureAmount(area.locator('.tabular').first(), minimum, language);
  }
  const statements = areas.locator('article').filter({ has: page.locator('a[href="/finance/statements"]') });
  await expect(statements).toBeVisible();
  await expect(statements.getByRole('status')).toHaveCount(0);
  // This live statement read may legitimately have no period; preserve that state.
  await expect(statements).toContainText(language === 'id' ? /Laba bersih/i : /net profit/i);
};
const reportReady: Route['ready'] = async (page, _width, language) => {
  const figures = page.getByRole('region', { name: language === 'id' ? 'Angka laporan' : 'Report figures' });
  await expect(figures.getByTestId('kpi-skeleton')).toHaveCount(0);
  const idr = figures.getByRole('region', { name: 'IDR' });
  await expectFixtureAmount(idr.locator('.tabular').nth(1), FINANCE_FIXTURE.contract, language);
};
const ROUTES: Route[] = [
  { name: 'executive', user: 'exec@acme.test', path: '/', ready: companyReady, widths: WIDTHS, bahasaWidths: [1440, 390] },
  { name: 'finance', user: 'finance@acme.test', path: '/finance', ready: financeReady, widths: WIDTHS, bahasaWidths: [1440] },
  { name: 'pm', user: 'pm@acme.test', path: '/', ready: async (p) => { await expect(p.getByTestId('kpi-my-contract-value').locator('.tabular').filter({ hasText: /160[.,]9/ })).toBeVisible(); }, widths: WIDTHS, bahasaWidths: [] },
  { name: 'revenue by project', user: 'exec@acme.test', path: '/revenue-by-project', ready: reportReady, widths: [1440, 390], bahasaWidths: [1440] },
  { name: 'management pack', user: 'exec@acme.test', path: '/reports', ready: reportReady, widths: [1440, 390], bahasaWidths: [1440] },
  // Phase 2 (#1529): the sales pipeline route joins the matrix — the weighted total is the loaded,
  // independently fetched figure; at 390px the phone layout renders deal cards, so readiness binds
  // to the phone card's full amount instead of the desktop weighted-total testid.
  { name: 'sales pipeline', user: 'exec@acme.test', path: '/sales', ready: async (p, width) => {
    const figure = width === 390 ? p.locator('main .tabular').filter({ hasText: /5,457,143,000/ }).first() : p.getByTestId('pipeline-weighted-total');
    await expect(figure).toContainText(width === 390 ? /5,457,143,000/ : /75,185,000,000/);
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
        await page.goto(route.path);
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
        await page.goto(route.path);
        await expect(page.locator('html')).toHaveAttribute('lang', 'id');
        await route.ready(page, width, 'id');
        await expectFiguresContained(page, `${route.name} ${width}px id`);
      });
    }
  }


});
}
