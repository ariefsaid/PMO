// @e2e-isolation: read-only — layout measurements on a seeded route; no writes.
import { test, expect, type Page } from '@playwright/test';
import { login } from '../helpers';
import { assertCompaniesSearchFits } from '../support/layout-oracles';
import { registerLayoutSweep } from '../support/layout-sweep';

registerLayoutSweep({ path: '/companies', label: 'companies', icons: true, integrations: false });

async function waitReady(page: Page) {
  await expect(page.getByTestId('liststate-loading')).toHaveCount(0, { timeout: 20_000 });
}

// ── AC-CO-001c — the toolbar search is reachable at 375px (no off-screen clip) ──

test(
  '@layout AC-CO-001c responsive: at 375px the Companies content fits the viewport and the toolbar search is fully reachable (not clipped)',
  async ({ page }) => {
    // Regression guard for the CSS-grid blowout: a bare `1fr` main track took a
    // min-content minimum, so a wide data table/toolbar pushed `main` past the
    // viewport and clipped the right-aligned search. The fix (minmax(0,1fr) +
    // min-w-0 on <main>) lets the track shrink. jsdom can't see layout, so this
    // is proven in a real browser.
    await page.setViewportSize({ width: 375, height: 812 });
    await login(page, 'admin@acme.test');
    await page.goto('/companies');
    await waitReady(page);

    await assertCompaniesSearchFits(page);
  },
);
