// @e2e-isolation: read-only — only navigates/asserts filter+search+scroll+return state; no DB write.
import { test, expect, type Locator, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * AC-LRC-005 (list-working-set-return, #682): a narrowed Procurement list, opened record, and a
 * return via the mobile BackBar AND the desktop parent breadcrumb both restore the same
 * status/search working set and a useful scroll position. A direct/copied record link (no
 * captured list context) falls back to the bare owning index.
 *
 * Seed: "PV Modules — Meridian 4.2 MW" and "PV Modules — Atlas 2.8 MW" are both Paid;
 * "String Inverters & Combiner Boxes" is Ordered (excluded by the Paid filter entirely).
 * Filtering to Paid narrows OUT the Ordered row; searching "Meridian" then narrows OUT
 * "PV Modules — Atlas 2.8 MW" too — so each control visibly removes a row, and the return must
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
  'AC-LRC-005: narrowing Procurement, opening a request, and returning (mobile BackBar + desktop breadcrumb) restores the filter/search/scroll; a direct visit falls back to the bare index',
  async ({ page }) => {
    // A small viewport height, not width, forces the row list to overflow `.main-scroll` even
    // with a handful of seeded rows, so the scroll-restore assertion is real, not trivially 0.
    await page.setViewportSize({ width: 1280, height: 420 });
    await login(page, 'pm@acme.test');
    await page.goto('/procurement');
    await waitReady(page);

    // ── Narrow: status=Paid, then a search ("Meridian") that removes the Atlas Paid row ──────
    await page.getByRole('tab', { name: /^Paid$/i }).click();
    await expect(page).toHaveURL(/[?&]status=Paid/);
    await expect(page.getByText('PV Modules — Atlas 2.8 MW')).toBeVisible();
    await expect(page.getByText('String Inverters & Combiner Boxes')).not.toBeVisible();
    const search = page.getByRole('searchbox', { name: /Filter requests/i });
    await search.fill('Meridian');
    await expect(page).toHaveURL(/[?&]q=Meridian/);
    await expect(page.getByText('PV Modules — Atlas 2.8 MW')).not.toBeVisible();
    await expect(page.getByText('PV Modules — Meridian 4.2 MW')).toBeVisible();

    const main = page.locator('.main-scroll');
    await expect(main).toBeVisible();
    await main.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    const scrolledTop = await main.evaluate((el) => el.scrollTop);

    // ── Open the request; capture its canonical URL for the direct-visit check below ─────────
    await page.getByRole('link', { name: 'PV Modules — Meridian 4.2 MW' }).click();
    await expect(page).toHaveURL(/\/procurement\/[0-9a-f-]+$/i, { timeout: 15_000 });
    const recordUrl = page.url();
    await expect(page.getByTestId('record-header')).toContainText('PV Modules — Meridian 4.2 MW');

    // ── Desktop parent breadcrumb return ──────────────────────────────────────────────────────
    await page
      .getByRole('navigation', { name: /breadcrumb/i })
      .getByRole('button', { name: /^procurement$/i })
      .click();
    await expect(page).toHaveURL(/[?&]status=Paid/, { timeout: 10_000 });
    await expect(page).toHaveURL(/[?&]q=Meridian/);
    await waitReady(page);
    await expect(page.getByRole('tab', { name: /^Paid$/i })).toHaveAttribute('aria-selected', 'true');
    await expect(search).toHaveValue('Meridian');
    // The narrowed SET came back, not just the URL: the searched-out and filtered-out rows stay
    // out. Scoped to the row's title `<link>` role so the locator can't transiently match the
    // breadcrumb/heading of the just-departed detail page during the return transition
    // (strict-mode ambiguity).
    await expect(page.getByRole('link', { name: 'PV Modules — Meridian 4.2 MW' })).toBeVisible();
    await expect(page.getByText('PV Modules — Atlas 2.8 MW')).not.toBeVisible();
    await expect(page.getByText('String Inverters & Combiner Boxes')).not.toBeVisible();
    await expectScrollRestored(main, scrolledTop);

    // ── Mobile BackBar return ────────────────────────────────────────────────────────────────
    // Resize FIRST: below the shell's mobile breakpoint the toolbar reflows (a different DOM
    // subtree), which discards any scrollTop set before the resize.
    await page.setViewportSize({ width: 390, height: 420 });
    await waitReady(page);
    await main.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    const mobileScrolledTop = await main.evaluate((el) => el.scrollTop);
    await page.getByRole('link', { name: 'PV Modules — Meridian 4.2 MW' }).click();
    await expect(page).toHaveURL(/\/procurement\/[0-9a-f-]+$/i, { timeout: 15_000 });
    await page.getByRole('button', { name: 'Back to Procurement', exact: true }).click();
    await expect(page).toHaveURL(/[?&]status=Paid/, { timeout: 10_000 });
    await expect(page).toHaveURL(/[?&]q=Meridian/);
    await waitReady(page);
    // Scope to the row's title `<link>` role so the locator can't transiently match the
    // breadcrumb/heading of the just-departed detail page during the return transition
    // (strict-mode ambiguity), the same class of race as the record-header/breadcrumb overlap.
    await expect(page.getByRole('link', { name: 'PV Modules — Meridian 4.2 MW' })).toBeVisible();
    await expect(page.getByText('PV Modules — Atlas 2.8 MW')).not.toBeVisible();
    await expectScrollRestored(main, mobileScrolledTop);

    // ── A direct/copied record link carries no captured list context — Back falls back to the
    //    bare owning index (a fresh tab/page has no in-app navigation history). ────────────────
    await page.setViewportSize({ width: 1280, height: 800 });
    const freshPage = await page.context().newPage();
    await freshPage.goto(recordUrl);
    await expect(freshPage.getByTestId('record-header')).toContainText('PV Modules — Meridian 4.2 MW', {
      timeout: 15_000,
    });
    await freshPage
      .getByRole('navigation', { name: /breadcrumb/i })
      .getByRole('button', { name: /^procurement$/i })
      .click();
    await expect(freshPage).toHaveURL(/\/procurement$/, { timeout: 10_000 });
    await freshPage.close();
  },
);
