// @e2e-isolation: read-only — only navigates/asserts filter+search+scroll+return state; no DB write.
import { test, expect, type Locator, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * AC-LRC-003 (list-working-set-return, #682): a narrowed Projects list, opened record, and a
 * return via the mobile BackBar AND the desktop parent breadcrumb both restore the same
 * status/search working set and a useful scroll position. A direct/copied record link (no
 * captured list context) falls back to the bare owning index.
 *
 * Seed: P001 "Innovate Corp HQ Fit-Out" and P003 "Acme Internal Platform" are both Ongoing;
 * P002 "Northwind ERP Rollout" is Tender Submitted (pipeline, excluded from Projects entirely).
 * Filtering to Ongoing narrows OUT the pipeline row; searching "Innovate" then narrows OUT
 * "Acme Internal Platform" too — so each control visibly removes a row, and the return must
 * bring back exactly that narrowed set, not just the URL.
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

test(
  'AC-LRC-003: narrowing Projects, opening a record, and returning (mobile BackBar + desktop breadcrumb) restores the filter/search/scroll; a direct visit falls back to the bare index',
  async ({ page }) => {
    // A small viewport height, not width, forces the row list to overflow `.main-scroll` even
    // with a handful of seeded rows, so the scroll-restore assertion is real, not trivially 0.
    await page.setViewportSize({ width: 1280, height: 420 });
    await login(page, 'pm@acme.test');
    await page.goto('/projects');
    await waitReady(page);

    // ── Narrow: status=Ongoing, then a search ("Innovate") that removes Acme Internal Platform ─
    await page.getByRole('tab', { name: /^Ongoing$/i }).click();
    await expect(page).toHaveURL(/[?&]filter=Ongoing/);
    await expect(page.getByText('Acme Internal Platform')).toBeVisible();
    await expect(page.getByText('Northwind ERP Rollout')).not.toBeVisible();
    const search = page.getByRole('searchbox', { name: /Search projects/i });
    await search.fill('Innovate');
    await expect(page).toHaveURL(/[?&]q=Innovate/);
    await expect(page.getByText('Acme Internal Platform')).not.toBeVisible();
    await expect(page.getByText('Innovate Corp HQ Fit-Out')).toBeVisible();

    const main = page.locator('.main-scroll');
    await expect(main).toBeVisible();
    await main.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    // Read the offset where the user IS when opening: the click scrolls an off-screen row into view first.
    await page.getByText('Innovate Corp HQ Fit-Out').scrollIntoViewIfNeeded();
    const scrolledTop = await main.evaluate((el) => el.scrollTop);

    // ── Open a record; capture its canonical URL for the direct-visit check below ───────────
    await page.getByText('Innovate Corp HQ Fit-Out').click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/i, { timeout: 15_000 });
    const recordUrl = page.url();
    await expect(page.getByTestId('record-header')).toContainText('Innovate Corp HQ Fit-Out');

    // ── Desktop parent breadcrumb return ──────────────────────────────────────────────────────
    await page
      .getByRole('navigation', { name: /breadcrumb/i })
      .getByRole('button', { name: /^projects$/i })
      .click();
    await expect(page).toHaveURL(/[?&]filter=Ongoing/, { timeout: 10_000 });
    await expect(page).toHaveURL(/[?&]q=Innovate/);
    await waitReady(page);
    await expect(page.getByRole('tab', { name: /^Ongoing$/i })).toHaveAttribute('aria-selected', 'true');
    await expect(search).toHaveValue('Innovate');
    // The narrowed SET came back, not just the URL: the searched-out and filtered-out rows stay
    // out. Scoped to the desktop table so the locator can't transiently match the breadcrumb of
    // the just-departed detail page during the return transition (strict-mode ambiguity).
    const table = page.getByRole('table');
    await expect(table.getByText('Innovate Corp HQ Fit-Out')).toBeVisible();
    await expect(table.getByText('Acme Internal Platform')).not.toBeVisible();
    await expect(table.getByText('Northwind ERP Rollout')).not.toBeVisible();
    await expectScrollRestored(main, scrolledTop);

    // ── Mobile BackBar return ────────────────────────────────────────────────────────────────
    // Resize FIRST: below `md` the table reflows into a mobile card list (a different DOM
    // subtree), which discards any scrollTop set before the resize.
    await page.setViewportSize({ width: 390, height: 420 });
    await waitReady(page);
    await main.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await page.getByText('Innovate Corp HQ Fit-Out').scrollIntoViewIfNeeded();
    const mobileScrolledTop = await main.evaluate((el) => el.scrollTop);
    await page.getByText('Innovate Corp HQ Fit-Out').click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/i, { timeout: 15_000 });
    await page.getByRole('button', { name: 'Back to Projects', exact: true }).click();
    await expect(page).toHaveURL(/[?&]filter=Ongoing/, { timeout: 10_000 });
    await expect(page).toHaveURL(/[?&]q=Innovate/);
    await waitReady(page);
    // Below `md` a row's title renders as a card `<button>` (not plain text like the desktop
    // table); scope to that role so the locator can't transiently match the breadcrumb/heading
    // of the just-departed detail page during the return transition (strict-mode ambiguity).
    await expect(page.getByRole('button', { name: 'Innovate Corp HQ Fit-Out' })).toBeVisible();
    await expect(page.getByText('Acme Internal Platform')).not.toBeVisible();
    await expectScrollRestored(main, mobileScrolledTop);

    // ── A direct/copied record link carries no captured list context — Back falls back to the
    //    bare owning index (a fresh tab/page has no in-app navigation history). ────────────────
    await page.setViewportSize({ width: 1280, height: 800 });
    const freshPage = await page.context().newPage();
    await freshPage.goto(recordUrl);
    await expect(freshPage.getByTestId('record-header')).toContainText('Innovate Corp HQ Fit-Out', {
      timeout: 15_000,
    });
    await freshPage
      .getByRole('navigation', { name: /breadcrumb/i })
      .getByRole('button', { name: /^projects$/i })
      .click();
    await expect(freshPage).toHaveURL(/\/projects$/, { timeout: 10_000 });
    await freshPage.close();
  },
);
