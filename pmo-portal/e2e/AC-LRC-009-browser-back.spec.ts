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

// #1887: the seeded Projects fixtures alone cannot scroll — after the search narrows to a
// single matching row, the filtered content fits the 420px viewport, so the scroll-restore
// proof would assert on a zero offset and fail before Back is ever exercised. These
// deterministic, client-shaped Ongoing rows are appended to the Projects LIST read, so the
// narrowed "Innovate" set keeps a positive scroll extent (several real-height rows).
const INNOVATE_FIXTURE_ROWS = [
  'Innovate Logistics Warehouse Automation',
  'Innovate Data Centre Retrofit Phase 2',
  'Innovate Retail Flagship Fit-Out Jakarta',
  'Innovate Campus Network Upgrade',
  'Innovate Water Treatment Package Lot 4',
  'Innovate Grid Battery Pilot Programme',
] as const;

/** Route-mock the active-partition Projects list read (GET with `status=in.`, no `id=eq.`). */
async function installScrollableListFixture(page: Page) {
  await page.route('**/rest/v1/projects?*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const status = url.searchParams.get('status') ?? '';
    if (request.method() !== 'GET' || url.searchParams.has('id') || !status.startsWith('in.')) {
      return route.fallback();
    }
    // Clone the live response's first row so every appended row carries the exact column
    // shape (embedded client/pm refs included) the app rendered for the seed — stable row
    // heights across visits, which the ±48px scroll-restore tolerance relies on.
    const response = await route.fetch();
    const rows = (await response.json()) as Array<Record<string, unknown>>;
    const base = rows.find((row) => row.status === 'Ongoing Project') ?? rows[0];
    if (!base) return route.fallback();
    const extra = INNOVATE_FIXTURE_ROWS.map((name, i) => ({
      ...base,
      id: `6e0f0000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      name,
      pmo_project_number: `PMO-2025-88${String(i + 1).padStart(2, '0')}`,
      code: `PO/SYN/2025/88${i + 1}`,
    }));
    return route.fulfill({ response, json: [...rows, ...extra] });
  });
}

test(
  'AC-LRC-009: narrowing a list writes no extra history entries; browser Back from an opened record restores the URL and scroll in one step',
  async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 420 });
    await login(page, 'pm@acme.test');
    await installScrollableListFixture(page);
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
