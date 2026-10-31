// @e2e-isolation: read-only — reads the seeded /sales route (and route-stubbed synthetic pipeline
// reads for AC-S24-004) and measures rendered boxes; the Bahasa passes only rewrite the READ
// response of the caller's own profile row in the browser (page.route), so no seed profile is
// ever written.
/**
 * /sales layout sweep — the consolidated geometry gate for the Sales Pipeline route.
 *
 * One page load per viewport/theme per concern, all oracles via e2e/support helpers:
 *   - the shared no-bleed + oversized-icon sweep (AC-MOBILE-OVERFLOW-001 / AC-VISUAL-ICON-001),
 *   - the figure-containment matrix row (AC-RD-GEOM-001, shared fixture installIdrDashboardFixture),
 *   - AC-SBC-001 board card money-row containment (en/id × 390/1440 in ONE load per language —
 *     resize between widths; language is resolved at boot so one load per language is the floor),
 *   - AC-SFA-001/006/007 funnel amount, bar-gap and focus-ring containment at the 768px breakpoint
 *     in a single load (same page state, three independent oracles),
 *   - AC-S24-004 phone identity/geometry/disclosure/activation over the synthetic worst-case
 *     pipeline (long names + trillion-scale IDR) in en/id × light/dark.
 */
import { expect, test, type Page } from '@playwright/test';
import { signIn, waitForFonts } from '../helpers';
import { registerFigureLayout } from '../support/figure-layout';
import { registerLayoutSweep } from '../support/layout-sweep';
import {
  assertFunnelAmountsContained,
  assertFunnelBarGapAndAlignment,
  assertFunnelFocusRingInsideViewport,
  assertPhonePipelineGeometry,
  assertSalesBoardCards,
} from '../support/layout-oracles';
import { LONG_NAME, LONG_CUSTOMER, OPEN_PROJECTS, openSalesPipeline } from '../support/sales-pipeline-fixtures';

registerLayoutSweep({ path: '/sales', label: 'sales-pipeline', icons: true });

registerFigureLayout('sales pipeline');

/** Bahasa without a persisted profile write: rewrite the profile row the AuthProvider reads. */
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

for (const { name, bahasa } of [
  { name: 'English', bahasa: false },
  { name: 'Bahasa Indonesia', bahasa: true },
] as const) {
  // One load per language covers both widths: the board re-flows on resize, so the same DOM is
  // measured at 390px and 1440px without paying a second page load.
  test(`@layout AC-SBC-001: ${name} at 390px and 1440px — every card descendant stays inside the card and no card list scrolls sideways`, async ({
    page,
  }) => {
    if (bahasa) await forceBahasa(page);
    await page.setViewportSize({ width: 390, height: 900 });
    await signIn(page, 'admin@acme.test');
    await page.goto('/sales?view=kanban');
    if (bahasa) await expect(page.locator('html')).toHaveAttribute('lang', 'id', { timeout: 60_000 });
    await expect(page.getByTestId('project-card').first()).toBeVisible({ timeout: 60_000 });
    await waitForFonts(page);
    await assertSalesBoardCards(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByTestId('project-card').first()).toBeVisible();
    await waitForFonts(page);
    await assertSalesBoardCards(page);
  });
}

test('@layout AC-SFA-001 AC-SFA-006 AC-SFA-007: funnel amounts, progress-bar gap and focus rings stay contained at the 768px breakpoint', async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 844 });
  await signIn(page, 'admin@acme.test');
  await page.goto('/sales');
  await assertFunnelAmountsContained(page);
  await assertFunnelBarGapAndAlignment(page);
  await assertFunnelFocusRingInsideViewport(page);
});

// AC-S24-004 (phone identity/geometry/disclosure/canonical activation) over the synthetic
// worst-case pipeline: language and theme both change what renders, so each combination keeps its
// own load — the phone stage list, identity and activation oracles are unchanged.
for (const locale of ['en', 'id'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`@layout AC-S24-004: phone identity, geometry, disclosure, and canonical activation in ${locale}/${theme}`, async ({
      page,
    }) => {
      await openSalesPipeline(page, locale, theme, { width: 390, height: 844 });
      const selector = page.getByRole('combobox', { name: locale === 'id' ? 'Tahap pipeline' : 'Pipeline stage' });
      await expect(selector).toBeVisible();
      await expect(page.getByRole('combobox', { name: locale === 'id' ? 'Tahap pipeline' : 'Pipeline stage' })).toHaveCount(1);
      const phoneList = page.getByTestId('sales-phone-stage-list');
      await expect(phoneList.locator(':scope > li')).toHaveCount(OPEN_PROJECTS.length);
      const firstCard = phoneList.getByTestId('project-card').first();
      await expect(firstCard.getByText(LONG_NAME, { exact: true })).toBeVisible();
      await expect(firstCard.getByText(LONG_CUSTOMER, { exact: true })).toBeVisible();
      await expect(firstCard.getByText(/1[.,]250(?:[.,]000){3}/)).toBeVisible();
      await expect(firstCard.getByTestId('tax-basis')).toHaveAttribute('data-tax-basis', 'inclusive');
      await waitForFonts(page);
      await assertPhonePipelineGeometry(page);

      // SUB-H: no per-card details disclosure; the value and win % sit on the card itself.
      await expect(firstCard.locator('details')).toHaveCount(0);

      await firstCard.getByRole('button', { name: LONG_NAME, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/projects/${OPEN_PROJECTS[0].id}$`));
      await page.goBack();
      await expect(page).toHaveURL(/\/sales\?view=kanban$/);
      await expect(phoneList.locator(':scope > li')).toHaveCount(OPEN_PROJECTS.length);
    });
  }
}
