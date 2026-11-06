// @e2e-isolation: read-only — signIn + navigate seeded routes under CDP throttling (CPU 4x + Slow 4G); no DB writes anywhere.
import { test, expect, type CDPSession } from '@playwright/test';
import { signIn } from './helpers';

/**
 * AC-1834 — late route code starts downloading in parallel with the route's data (#1834).
 *
 * The app preloads a route's lazy chunk (and its late in-page chunks, e.g. the
 * MinutesEditor/BlockNote editor on meeting detail) on nav-link hover/focus/pointerdown
 * and on route entry (lazyWithPreload + App.tsx PRELOAD_RULES). On a slow machine the
 * user-visible oracle is: the route's CONTENT appears (including the late editor), and the
 * app-wide loading spinner (`LoadingFallback`, aria-label "Loading page") never comes back
 * after content is on screen — the "second spinner" the issue was filed with.
 *
 * Throttling: CDP Emulation.setCPUThrottlingRate 4 + Lighthouse Slow 4G, applied right
 * before the measured navigation so the slow window isolates the route transition.
 * Dependencies (this spec fails loudly without them, never silently skips): the seeded
 * local Supabase (supabase/seed.sql §V meeting; AC-PROC list rows) and the captured
 * storageState fixtures signIn() replays (e2e/.auth/, produced by the `setup` project).
 */

const SEEDED_MEETING_TITLE = 'Meridian PV — weekly site coordination';

const SLOW_4G = { latency: 150, downloadThroughput: 1.6 * 1024 * 1024, uploadThroughput: 750 * 1024 };

async function throttle(page: import('@playwright/test').Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, ...SLOW_4G });
  return cdp;
}

/**
 * Record the app-wide spinner's up/down timeline (browser-clock epoch ms) via a
 * MutationObserver, so a spinner that appeared and vanished while assertions ran is
 * still accounted for afterwards.
 */
async function recordSpinnerTimeline(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const log: Array<{ t: number; up: boolean }> = [];
    (window as unknown as { __spinnerLog: typeof log }).__spinnerLog = log;
    const up = () => Boolean(document.querySelector('[aria-label="Loading page"]'));
    let current = up();
    log.push({ t: Date.now(), up: current });
    new MutationObserver(() => {
      const now = up();
      if (now !== current) {
        current = now;
        log.push({ t: Date.now(), up: now });
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  });
}

async function spinnerUpsAfter(page: import('@playwright/test').Page, sinceEpochMs: number) {
  const log = await page.evaluate(() => (window as unknown as { __spinnerLog: Array<{ t: number; up: boolean }> }).__spinnerLog);
  return log.filter((entry) => entry.up && entry.t > sinceEpochMs);
}

test.describe('AC-1834 content shows without a second app-wide spinner under throttling', () => {
  test.setTimeout(180_000);

  test('AC-1834: meeting detail — the minutes editor arrives with the record, no app-wide spinner comes back', async ({
    page,
  }) => {
    await signIn(page, 'pm@acme.test'); // seeded author: the minutes EDITOR surface, not read-only minutes
    await page.goto('/meetings');
    await expect(page.getByTestId('list-page-header')).toBeVisible();
    await expect(page.getByText(SEEDED_MEETING_TITLE)).toBeVisible();

    await throttle(page);
    await recordSpinnerTimeline(page);

    const row = page.getByRole('row').filter({ hasText: SEEDED_MEETING_TITLE }).first();
    await row.click();

    // Content: the record AND the late MinutesEditor/BlockNote chunk — the code this issue
    // found loading only after the meeting data arrived. Preloaded at route entry, so under
    // throttling it mounts with the record instead of trailing it behind a second wait.
    await expect(page.getByTestId('record-header')).toBeVisible({ timeout: 90_000 });
    const contentAt = Date.now();
    await expect(page.getByTestId('minutes-blocknote').locator('.bn-editor')).toBeVisible({ timeout: 90_000 });

    // The oracle: once content is on screen the app-wide spinner never reappears.
    const secondSpinners = await spinnerUpsAfter(page, contentAt);
    expect(secondSpinners, 'app-wide spinner reappeared after content under throttling').toEqual([]);
  });

  test('AC-1834: procurement list — content renders off the preloaded page chunk, no app-wide spinner comes back', async ({
    page,
  }) => {
    await signIn(page, 'pm@acme.test');
    await page.goto('/');
    const railLink = page.locator('aside nav a[href="/procurement"]');
    await expect(railLink).toBeVisible();

    await throttle(page);
    await recordSpinnerTimeline(page);

    // Hover first — the nav-link preload this issue adds starts the page's chunk graph now,
    // so the click pays only for data. (The hover also keeps the journey a real user path.)
    await railLink.hover();
    await page.waitForTimeout(1_500);
    await railLink.click();

    // Content: the list is ready (KPI summary renders only once reads have landed, or the
    // table itself on views without rows).
    await expect(
      page.locator('section[aria-label="Procurement summary"], div[role="tabpanel"] table').first(),
    ).toBeVisible({ timeout: 90_000 });
    const contentAt = Date.now();
    await page.waitForTimeout(1_500); // a late spinner would need to mount within this window to be caught

    const secondSpinners = await spinnerUpsAfter(page, contentAt);
    expect(secondSpinners, 'app-wide spinner reappeared after content under throttling').toEqual([]);
  });
});
