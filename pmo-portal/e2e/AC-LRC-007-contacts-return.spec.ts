// @e2e-isolation: read-only — only navigates/asserts filter+search+scroll+return state; no DB write.
import { test, expect, type Locator, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * AC-LRC-007 (list-working-set-return, #683): a narrowed Contacts list, opened record, and a
 * return via the mobile BackBar AND the desktop parent breadcrumb both restore the same
 * search/company working set and a useful scroll position. A direct/copied record link (no
 * captured list context) falls back to the bare owning index.
 *
 * Seed: Meridian Steelworks' three contacts are Priya Mehta, James Harlow and Sandra Reyes.
 * Filtering to that company narrows by COMPANY (Lena Bauer, a SunVolt contact, disappears);
 * searching "h" then narrows by SEARCH too — it excludes Sandra Reyes, whose name and email carry
 * no "h" — so each control visibly removes a row, and the return must bring back exactly that
 * narrowed set, not just the URL.
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

const OPEN_JAMES = { name: 'Open James Harlow', exact: true };

test(
  'AC-LRC-007: narrowing Contacts, opening a record, and returning (mobile BackBar + desktop breadcrumb) restores the filter/search/scroll; a direct visit falls back to the bare index',
  async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 420 });
    await login(page, 'admin@acme.test');
    await page.goto('/contacts');
    await waitReady(page);

    // ── Narrow: company=Meridian Steelworks, then a search ("h") that removes Sandra Reyes ────
    await page.getByLabel(/Filter by company/i).selectOption({ label: 'Meridian Steelworks' });
    await expect(page).toHaveURL(/[?&]company=[0-9a-f-]+/i);
    await expect(page.getByText('Sandra Reyes')).toBeVisible();
    await expect(page.getByText('Lena Bauer')).not.toBeVisible(); // a SunVolt contact — different company
    const search = page.getByRole('searchbox', { name: /Search contacts/i });
    await search.fill('h');
    await expect(page).toHaveURL(/[?&]q=h(&|$)/);
    await expect(page.getByText('Priya Mehta')).toBeVisible();
    await expect(page.getByText('Sandra Reyes')).not.toBeVisible();

    const main = page.locator('.main-scroll');
    await expect(main).toBeVisible();
    await main.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    // Read the offset where the user IS when opening: the click scrolls an off-screen row into view first.
    await page.getByRole('button', OPEN_JAMES).scrollIntoViewIfNeeded();
    const scrolledTop = await main.evaluate((el) => el.scrollTop);
    expect(scrolledTop).toBeGreaterThan(0);

    // ── Open a record; capture its canonical URL for the direct-visit check below ───────────
    await page.getByRole('button', OPEN_JAMES).click();
    await expect(page).toHaveURL(/\/contacts\/[0-9a-f-]+$/i, { timeout: 15_000 });
    const recordUrl = page.url();
    await expect(page.getByTestId('record-header')).toContainText('James Harlow');

    // ── Desktop parent breadcrumb return ──────────────────────────────────────────────────────
    await page
      .getByRole('navigation', { name: /breadcrumb/i })
      .getByRole('button', { name: /^contacts$/i })
      .click();
    await expect(page).toHaveURL(/[?&]company=[0-9a-f-]+/i, { timeout: 10_000 });
    await expect(page).toHaveURL(/[?&]q=h(&|$)/);
    await waitReady(page);
    await expect(page.getByLabel(/Filter by company/i)).toHaveValue(/[0-9a-f-]+/i);
    await expect(search).toHaveValue('h');
    // The narrowed SET came back, not just the URL: the searched-out and filtered-out rows stay out.
    await expect(page.getByRole('button', OPEN_JAMES)).toBeVisible();
    await expect(page.getByText('Sandra Reyes')).not.toBeVisible();
    await expect(page.getByText('Lena Bauer')).not.toBeVisible();
    await expectScrollRestored(main, scrolledTop);

    // ── Mobile BackBar return ────────────────────────────────────────────────────────────────
    // Resize FIRST: below `md` DataTable swaps its desktop table branch for a mobile card list
    // (a different DOM subtree), which discards any scrollTop set before the resize.
    await page.setViewportSize({ width: 390, height: 420 });
    await waitReady(page);
    await main.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await page.getByRole('button', OPEN_JAMES).scrollIntoViewIfNeeded();
    const mobileScrolledTop = await main.evaluate((el) => el.scrollTop);
    expect(mobileScrolledTop).toBeGreaterThan(0);
    await page.getByRole('button', OPEN_JAMES).click();
    await expect(page).toHaveURL(/\/contacts\/[0-9a-f-]+$/i, { timeout: 15_000 });
    await page.getByRole('button', { name: 'Back to Contacts', exact: true }).click();
    await expect(page).toHaveURL(/[?&]company=[0-9a-f-]+/i, { timeout: 10_000 });
    await expect(page).toHaveURL(/[?&]q=h(&|$)/);
    await waitReady(page);
    await expect(page.getByRole('button', OPEN_JAMES)).toBeVisible();
    await expect(page.getByText('Sandra Reyes')).not.toBeVisible();
    await expectScrollRestored(main, mobileScrolledTop);

    // ── A direct/copied record link carries no captured list context — Back falls back to the
    //    bare owning index. ─────────────────────────────────────────────────────────────────
    await page.setViewportSize({ width: 1280, height: 800 });
    const freshPage = await page.context().newPage();
    await freshPage.goto(recordUrl);
    await expect(freshPage.getByTestId('record-header')).toContainText('James Harlow', {
      timeout: 15_000,
    });
    await freshPage
      .getByRole('navigation', { name: /breadcrumb/i })
      .getByRole('button', { name: /^contacts$/i })
      .click();
    await expect(freshPage).toHaveURL(/\/contacts$/, { timeout: 10_000 });
    await freshPage.close();
  },
);
