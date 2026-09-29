// @e2e-isolation: read-only — only navigates/asserts filter+search+scroll+return state; no DB write.
import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * AC-LRC-009 (list-working-set-return, #682): every list control write (search keystrokes,
 * filter/view changes) is a history REPLACE, never a push — so narrowing a list never grows
 * `history.length`. Opening a record is the one PUSH. Native browser Back therefore lands
 * directly on the narrowed list URL in one step (no intermediate per-keystroke entry to click
 * through), and the list restores a useful scroll position once its content is ready.
 *
 * Seed: same Projects fixtures as AC-LRC-003 — P001 "Innovate Corp HQ Fit-Out" and P003 "Acme
 * Internal Platform" are both Ongoing; P002 "Northwind ERP Rollout" is Tender Submitted
 * (excluded from Projects, a pipeline-only row).
 */

test.setTimeout(120_000);

async function waitReady(page: Page) {
  await expect(page.getByTestId('liststate-loading')).toHaveCount(0, { timeout: 20_000 });
}

test(
  'AC-LRC-009: narrowing a list writes no extra history entries; browser Back from an opened record restores the URL and scroll in one step',
  async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 420 });
    await login(page, 'pm@acme.test');
    await page.goto('/projects');
    await waitReady(page);

    // A control change (the status tab) replaces, not pushes.
    const historyBeforeFilter = await page.evaluate(() => window.history.length);
    await page.getByRole('tab', { name: /^Ongoing$/i }).click();
    await expect(page).toHaveURL(/[?&]filter=Ongoing/);
    expect(await page.evaluate(() => window.history.length)).toBe(historyBeforeFilter);

    // Typing a multi-character search string is ONE debounced replace, not one push per
    // keystroke — history.length must not grow no matter how many characters were typed.
    const search = page.getByRole('searchbox', { name: /Search projects/i });
    await search.pressSequentially('Innovate', { delay: 30 });
    await expect(page).toHaveURL(/[?&]q=Innovate/, { timeout: 5_000 });
    await expect(page.getByText('Acme Internal Platform')).not.toBeVisible();
    expect(await page.evaluate(() => window.history.length)).toBe(historyBeforeFilter);
    const narrowedUrl = page.url();

    const main = page.locator('.main-scroll');
    await expect(main).toBeVisible();
    await main.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    // Read the offset where the user IS when opening: the click scrolls an off-screen row into view first.
    await page.getByText('Innovate Corp HQ Fit-Out').scrollIntoViewIfNeeded();
    const scrolledTop = await main.evaluate((el) => el.scrollTop);
    expect(scrolledTop).toBeGreaterThan(0);

    // Opening the record is the ONE push.
    const historyBeforeOpen = await page.evaluate(() => window.history.length);
    await page.getByText('Innovate Corp HQ Fit-Out').click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/i, { timeout: 15_000 });
    expect(await page.evaluate(() => window.history.length)).toBe(historyBeforeOpen + 1);

    // Native browser Back lands directly on the narrowed list URL — one step, not one per
    // keystroke typed earlier — and the list content + scroll position come back.
    await page.goBack();
    await expect(page).toHaveURL(narrowedUrl, { timeout: 10_000 });
    await waitReady(page);
    await expect(page.getByRole('tab', { name: /^Ongoing$/i })).toHaveAttribute('aria-selected', 'true');
    await expect(search).toHaveValue('Innovate');
    await expect(page.getByText('Innovate Corp HQ Fit-Out')).toBeVisible();
    await expect(page.getByText('Acme Internal Platform')).not.toBeVisible();
    await expect
      .poll(async () => Math.abs((await main.evaluate((el) => el.scrollTop)) - scrolledTop), {
        timeout: 10_000,
      })
      .toBeLessThanOrEqual(48);
  },
);
