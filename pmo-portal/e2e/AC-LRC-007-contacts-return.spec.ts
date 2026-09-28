// @e2e-isolation: read-only — only navigates/asserts filter+search+scroll+return state; no DB write.
import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * AC-LRC-007 (list-working-set-return, #683): a narrowed Contacts list, opened record, and a
 * return via the mobile BackBar AND the desktop parent breadcrumb both restore the same
 * search/company working set and a useful scroll position. A direct/copied record link (no
 * captured list context) falls back to the bare owning index.
 *
 * Seed: Meridian Steelworks' three contacts (Priya Mehta, James Harlow, Sandra Reyes) all
 * contain "a" — filtering to that company + searching "a" narrows by COMPANY without further
 * narrowing by SEARCH, letting both controls round-trip through the same journey.
 */

test.setTimeout(120_000);

async function waitReady(page: Page) {
  await expect(page.getByTestId('liststate-loading')).toHaveCount(0, { timeout: 20_000 });
}

const OPEN_SANDRA = { name: 'Open Sandra Reyes', exact: true };

test(
  'AC-LRC-007: narrowing Contacts, opening a record, and returning (mobile BackBar + desktop breadcrumb) restores the filter/search/scroll; a direct visit falls back to the bare index',
  async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 420 });
    await login(page, 'admin@acme.test');
    await page.goto('/contacts');
    await waitReady(page);

    // ── Narrow: company=Meridian Steelworks + a broad search ("a") that still matches all three
    //    of its contacts ────────────────────────────────────────────────────────────────────
    await page.getByLabel(/Filter by company/i).selectOption({ label: 'Meridian Steelworks' });
    await expect(page).toHaveURL(/[?&]company=[0-9a-f-]+/i);
    const search = page.getByRole('searchbox', { name: /Search contacts/i });
    await search.fill('a');
    await expect(page).toHaveURL(/[?&]q=a(&|$)/);
    await expect(page.getByText('Priya Mehta')).toBeVisible();
    await expect(page.getByText('Lena Bauer')).not.toBeVisible(); // a SunVolt contact — different company

    const main = page.locator('.main-scroll');
    await expect(main).toBeVisible();
    await main.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    const scrolledTop = await main.evaluate((el) => el.scrollTop);
    expect(scrolledTop).toBeGreaterThan(0);

    // ── Open a record; capture its canonical URL for the direct-visit check below ───────────
    await page.getByRole('button', OPEN_SANDRA).click();
    await expect(page).toHaveURL(/\/contacts\/[0-9a-f-]+$/i, { timeout: 15_000 });
    const recordUrl = page.url();
    await expect(page.getByTestId('record-header')).toContainText('Sandra Reyes');

    // ── Desktop parent breadcrumb return ──────────────────────────────────────────────────────
    await page
      .getByRole('navigation', { name: /breadcrumb/i })
      .getByRole('button', { name: /^contacts$/i })
      .click();
    await expect(page).toHaveURL(/[?&]company=[0-9a-f-]+/i, { timeout: 10_000 });
    await expect(page).toHaveURL(/[?&]q=a(&|$)/);
    await waitReady(page);
    await expect(page.getByLabel(/Filter by company/i)).toHaveValue(/[0-9a-f-]+/i);
    await expect(search).toHaveValue('a');
    await expect
      .poll(async () => main.evaluate((el) => el.scrollTop), { timeout: 10_000 })
      .toBeGreaterThan(0);

    // ── Mobile BackBar return ────────────────────────────────────────────────────────────────
    // Resize FIRST: below `md` DataTable swaps its desktop table branch for a mobile card list
    // (a different DOM subtree), which discards any scrollTop set before the resize.
    await page.setViewportSize({ width: 390, height: 420 });
    await waitReady(page);
    await main.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await page.getByRole('button', OPEN_SANDRA).click();
    await expect(page).toHaveURL(/\/contacts\/[0-9a-f-]+$/i, { timeout: 15_000 });
    await page.getByRole('button', { name: /back to contacts/i }).click();
    await expect(page).toHaveURL(/[?&]company=[0-9a-f-]+/i, { timeout: 10_000 });
    await expect(page).toHaveURL(/[?&]q=a(&|$)/);
    await waitReady(page);
    await expect
      .poll(async () => main.evaluate((el) => el.scrollTop), { timeout: 10_000 })
      .toBeGreaterThan(0);

    // ── A direct/copied record link carries no captured list context — Back falls back to the
    //    bare owning index. ─────────────────────────────────────────────────────────────────
    await page.setViewportSize({ width: 1280, height: 800 });
    const freshPage = await page.context().newPage();
    await freshPage.goto(recordUrl);
    await expect(freshPage.getByTestId('record-header')).toContainText('Sandra Reyes', {
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
