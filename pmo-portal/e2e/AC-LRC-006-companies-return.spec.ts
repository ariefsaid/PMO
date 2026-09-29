// @e2e-isolation: read-only — only navigates/asserts filter+search+scroll+return state; no DB write.
import { test, expect, type Locator, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * AC-LRC-006 (list-working-set-return, #683): a narrowed Companies list, opened record, and a
 * return via the mobile BackBar AND the desktop parent breadcrumb both restore the same
 * search/type working set and a useful scroll position. A direct/copied record link (no captured
 * list context) falls back to the bare owning index.
 *
 * Seed: c0000000-…-0008..0011 are the four Vendor companies (SunVolt Modules Co., VoltEdge
 * Inverters, RackMount Structures, CableCore Electrical). Filtering to Vendor narrows by TYPE
 * (Meridian Steelworks, a Client, disappears); searching "r" then narrows by SEARCH too — it
 * excludes SunVolt Modules Co., the one vendor without an "r" — so each control visibly removes a
 * row, and the return must bring back exactly that narrowed set, not just the URL.
 */

test.setTimeout(120_000);

async function waitReady(page: Page) {
  await expect(page.getByTestId('liststate-loading')).toHaveCount(0, { timeout: 20_000 });
}

/** "Nearby position" (FR-LRC-005): the restored offset lands within one row of the captured one. */
const SCROLL_TOLERANCE_PX = 48;
async function expectScrollRestored(main: Locator, captured: number) {
  await expect
    .poll(async () => Math.abs((await main.evaluate((el) => el.scrollTop)) - captured), {
      timeout: 10_000,
    })
    .toBeLessThanOrEqual(SCROLL_TOLERANCE_PX);
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

    // ── Narrow: type=Vendor, then a search ("r") that removes SunVolt Modules Co. ─────────────
    await page.getByRole('tab', { name: /^Vendor$/i }).click();
    await expect(page).toHaveURL(/[?&]type=Vendor/);
    await expect(page.getByText('SunVolt Modules Co.')).toBeVisible();
    await expect(page.getByText('Meridian Steelworks')).not.toBeVisible();
    const search = page.getByRole('searchbox', { name: /Search companies/i });
    await search.fill('r');
    await expect(page).toHaveURL(/[?&]q=r(&|$)/);
    await expect(page.getByText('SunVolt Modules Co.')).not.toBeVisible();
    await expect(page.getByRole('button', OPEN_CABLECORE)).toBeVisible();

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
    await expect(page).toHaveURL(/[?&]q=r(&|$)/);
    await waitReady(page);
    await expect(page.getByRole('tab', { name: /^Vendor$/i })).toHaveAttribute('aria-selected', 'true');
    await expect(search).toHaveValue('r');
    // The narrowed SET came back, not just the URL: the searched-out and filtered-out rows stay out.
    await expect(page.getByRole('button', OPEN_CABLECORE)).toBeVisible();
    await expect(page.getByText('SunVolt Modules Co.')).not.toBeVisible();
    await expect(page.getByText('Meridian Steelworks')).not.toBeVisible();
    await expectScrollRestored(main, scrolledTop);

    // ── Mobile BackBar return ────────────────────────────────────────────────────────────────
    // Resize FIRST: below `md` DataTable swaps its desktop table branch for a mobile card list
    // (a different DOM subtree), which discards any scrollTop set before the resize.
    await page.setViewportSize({ width: 390, height: 420 });
    await waitReady(page);
    await main.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    const mobileScrolledTop = await main.evaluate((el) => el.scrollTop);
    expect(mobileScrolledTop).toBeGreaterThan(0);
    await page.getByRole('button', OPEN_CABLECORE).click();
    await expect(page).toHaveURL(/\/companies\/[0-9a-f-]+$/i, { timeout: 15_000 });
    await page.getByRole('button', { name: 'Back to Companies', exact: true }).click();
    await expect(page).toHaveURL(/[?&]type=Vendor/, { timeout: 10_000 });
    await expect(page).toHaveURL(/[?&]q=r(&|$)/);
    await waitReady(page);
    await expect(page.getByRole('button', OPEN_CABLECORE)).toBeVisible();
    await expect(page.getByText('SunVolt Modules Co.')).not.toBeVisible();
    await expectScrollRestored(main, mobileScrolledTop);

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
