// @e2e-isolation: read-only — only navigates/asserts filter+search+scroll+return state; no DB write.
import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * AC-LRC-006 (list-working-set-return, #683): a narrowed Companies list, opened record, and a
 * return via the mobile BackBar AND the desktop parent breadcrumb both restore the same
 * search/type working set and a useful scroll position. A direct/copied record link (no captured
 * list context) falls back to the bare owning index.
 *
 * Seed: c0000000-…-0008..0011 are the four Vendor companies (SunVolt Modules Co., VoltEdge
 * Inverters, RackMount Structures, CableCore Electrical) — every name contains "e", so filtering
 * to Vendor + searching "e" narrows by TYPE without further narrowing by SEARCH, letting both
 * controls round-trip through the same journey.
 */

test.setTimeout(120_000);

async function waitReady(page: Page) {
  await expect(page.getByTestId('liststate-loading')).toHaveCount(0, { timeout: 20_000 });
}

const OPEN_CABLECORE = { name: 'Open CableCore Electrical', exact: true };

test(
  'AC-LRC-006: narrowing Companies, opening a record, and returning (mobile BackBar + desktop breadcrumb) restores the filter/search/scroll; a direct visit falls back to the bare index',
  async ({ page }) => {
    // A small viewport height, not width, forces the row list to overflow `.main-scroll` even
    // with a handful of seeded rows, so the scroll-restore assertion is real, not trivially 0.
    await page.setViewportSize({ width: 1280, height: 420 });
    await login(page, 'admin@acme.test');
    await page.goto('/companies');
    await waitReady(page);

    // ── Narrow: type=Vendor + a broad search ("e") that still matches every vendor row ──────
    await page.getByRole('tab', { name: /^Vendor$/i }).click();
    await expect(page).toHaveURL(/[?&]type=Vendor/);
    const search = page.getByRole('searchbox', { name: /Search companies/i });
    await search.fill('e');
    await expect(page).toHaveURL(/[?&]q=e(&|$)/);
    await expect(page.getByText('SunVolt Modules Co.')).toBeVisible();
    await expect(page.getByText('Meridian Steelworks')).not.toBeVisible();

    const main = page.locator('.main-scroll');
    await expect(main).toBeVisible();
    await main.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    const scrolledTop = await main.evaluate((el) => el.scrollTop);
    expect(scrolledTop).toBeGreaterThan(0);

    // ── Open a record; capture its canonical URL for the direct-visit check below ───────────
    await page.getByRole('button', OPEN_CABLECORE).click();
    await expect(page).toHaveURL(/\/companies\/[0-9a-f-]+$/i, { timeout: 15_000 });
    const recordUrl = page.url();
    await expect(page.getByTestId('record-header')).toContainText('CableCore Electrical');

    // ── Desktop parent breadcrumb return ──────────────────────────────────────────────────────
    await page
      .getByRole('navigation', { name: /breadcrumb/i })
      .getByRole('button', { name: /^companies$/i })
      .click();
    await expect(page).toHaveURL(/[?&]type=Vendor/, { timeout: 10_000 });
    await expect(page).toHaveURL(/[?&]q=e(&|$)/);
    await waitReady(page);
    await expect(page.getByRole('tab', { name: /^Vendor$/i })).toHaveAttribute('aria-selected', 'true');
    await expect(search).toHaveValue('e');
    // Best-effort scroll restore: nonzero (not reset to the top).
    await expect
      .poll(async () => main.evaluate((el) => el.scrollTop), { timeout: 10_000 })
      .toBeGreaterThan(0);

    // ── Mobile BackBar return ────────────────────────────────────────────────────────────────
    // Resize FIRST: below `md` DataTable swaps its desktop table branch for a mobile card list
    // (a different DOM subtree), which discards any scrollTop set before the resize.
    await page.setViewportSize({ width: 390, height: 420 });
    await waitReady(page);
    await main.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await page.getByRole('button', OPEN_CABLECORE).click();
    await expect(page).toHaveURL(/\/companies\/[0-9a-f-]+$/i, { timeout: 15_000 });
    await page.getByRole('button', { name: /back to companies/i }).click();
    await expect(page).toHaveURL(/[?&]type=Vendor/, { timeout: 10_000 });
    await expect(page).toHaveURL(/[?&]q=e(&|$)/);
    await waitReady(page);
    await expect
      .poll(async () => main.evaluate((el) => el.scrollTop), { timeout: 10_000 })
      .toBeGreaterThan(0);

    // ── A direct/copied record link carries no captured list context — Back falls back to the
    //    bare owning index (a fresh tab/page has no in-app navigation history). ────────────────
    await page.setViewportSize({ width: 1280, height: 800 });
    const freshPage = await page.context().newPage();
    await freshPage.goto(recordUrl);
    await expect(freshPage.getByTestId('record-header')).toContainText('CableCore Electrical', {
      timeout: 15_000,
    });
    await freshPage
      .getByRole('navigation', { name: /breadcrumb/i })
      .getByRole('button', { name: /^companies$/i })
      .click();
    await expect(freshPage).toHaveURL(/\/companies$/, { timeout: 10_000 });
    await freshPage.close();
  },
);
