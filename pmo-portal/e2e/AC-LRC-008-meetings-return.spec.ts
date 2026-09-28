// @e2e-isolation: self-isolated — the dev seed carries exactly ONE non-template meeting (a scroll
// journey needs several rows to overflow the list), so this spec creates its own uniquely-named
// meetings (Date.now()) via the app's own "New meeting" form and deletes them again at the end
// (finally block, retry-safe); it never touches a shared seed row.
import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * AC-LRC-008 (list-working-set-return, #683): a narrowed Meetings list, opened record, and a
 * return via the mobile BackBar AND the desktop parent breadcrumb both restore the same
 * search/project working set and a useful scroll position. A direct/copied record link (no
 * captured list context) falls back to the bare owning index. Meetings' project/search
 * narrowing is a SERVER query (DD-MTG-5) — this proves the real cross-stack round trip.
 *
 * The seed's one real meeting is "Meridian PV — weekly site coordination", on the "Meridian
 * Steelworks 4.2 MW Rooftop PV" project. This spec adds two more meetings on the same project
 * whose titles also contain "coordination", so filtering by that project + searching
 * "coordination" narrows to exactly the three (enough rows to force a real scroll) without
 * excluding any of them.
 */

test.setTimeout(180_000);

const PROJECT_NAME = 'Meridian Steelworks 4.2 MW Rooftop PV';

async function waitReady(page: Page) {
  await expect(page.getByTestId('liststate-loading')).toHaveCount(0, { timeout: 20_000 });
}

async function createMeeting(page: Page, title: string): Promise<string> {
  await page.goto('/meetings');
  await waitReady(page);
  await page.getByRole('button', { name: /new meeting/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 8_000 });
  await dialog.getByLabel(/^Title$/i).fill(title);
  await dialog.getByLabel(/^Project$/i).selectOption({ label: PROJECT_NAME });
  await dialog.getByRole('button', { name: /create meeting/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/meetings\/[0-9a-f-]+$/i, { timeout: 15_000 });
  return page.url().split('/meetings/')[1];
}

async function deleteMeeting(page: Page, id: string) {
  await page.goto(`/meetings/${id}`);
  await waitReady(page);
  const deleteBtn = page.getByTestId('meeting-delete');
  if (!(await deleteBtn.isVisible().catch(() => false))) return;
  await deleteBtn.click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible({ timeout: 8_000 });
  await dialog.getByRole('button', { name: /delete meeting/i }).click();
  await expect(page).toHaveURL(/\/meetings$/, { timeout: 15_000 });
}

test('AC-LRC-008: narrowing Meetings, opening a record, and returning (mobile BackBar + desktop breadcrumb) restores the filter/search/scroll; a direct visit falls back to the bare index', async ({
  page,
}) => {
  const runId = Date.now();
  const titleA = `Coordination Sync ${runId}-A`;
  const titleB = `Coordination Sync ${runId}-B`;
  const createdIds: string[] = [];

  await page.setViewportSize({ width: 1280, height: 420 });
  await login(page, 'admin@acme.test');

  try {
    createdIds.push(await createMeeting(page, titleA));
    createdIds.push(await createMeeting(page, titleB));

    // ── Narrow: project=Meridian + a search ("coordination") matching all three rows ────────
    await page.goto('/meetings');
    await waitReady(page);
    await page.getByLabel(/Filter by project/i).selectOption({ label: PROJECT_NAME });
    await expect(page).toHaveURL(/[?&]project=[0-9a-f-]+/i);
    const search = page.getByRole('searchbox', { name: /Search meetings/i });
    await search.fill('coordination');
    await expect(page).toHaveURL(/[?&]q=coordination(&|$)/);
    await expect(page.getByText(titleA)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(titleB)).toBeVisible();
    await expect(page.getByText('Meridian PV — weekly site coordination')).toBeVisible();

    const main = page.locator('.main-scroll');
    await expect(main).toBeVisible();
    await main.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    const scrolledTop = await main.evaluate((el) => el.scrollTop);
    expect(scrolledTop).toBeGreaterThan(0);

    // ── Open a record; capture its canonical URL for the direct-visit check below ───────────
    await page.getByText(titleB).click();
    await expect(page).toHaveURL(/\/meetings\/[0-9a-f-]+$/i, { timeout: 15_000 });
    const recordUrl = page.url();
    await expect(page.getByTestId('record-header')).toContainText(titleB);

    // ── Desktop parent breadcrumb return ──────────────────────────────────────────────────────
    await page
      .getByRole('navigation', { name: /breadcrumb/i })
      .getByRole('button', { name: /^meetings$/i })
      .click();
    await expect(page).toHaveURL(/[?&]project=[0-9a-f-]+/i, { timeout: 10_000 });
    await expect(page).toHaveURL(/[?&]q=coordination(&|$)/);
    await waitReady(page);
    await expect(page.getByLabel(/Filter by project/i)).toHaveValue(/[0-9a-f-]+/i);
    await expect(search).toHaveValue('coordination');
    await expect
      .poll(async () => main.evaluate((el) => el.scrollTop), { timeout: 10_000 })
      .toBeGreaterThan(0);

    // ── Mobile BackBar return ────────────────────────────────────────────────────────────────
    // Resize FIRST: below `md` DataTable swaps its desktop table branch for a mobile card list
    // (a different DOM subtree), which discards any scrollTop set before the resize.
    await page.setViewportSize({ width: 390, height: 420 });
    await waitReady(page);
    await main.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await page.getByText(titleB).click();
    await expect(page).toHaveURL(/\/meetings\/[0-9a-f-]+$/i, { timeout: 15_000 });
    await page.getByRole('button', { name: /back to meetings/i }).click();
    await expect(page).toHaveURL(/[?&]project=[0-9a-f-]+/i, { timeout: 10_000 });
    await expect(page).toHaveURL(/[?&]q=coordination(&|$)/);
    await waitReady(page);
    await expect
      .poll(async () => main.evaluate((el) => el.scrollTop), { timeout: 10_000 })
      .toBeGreaterThan(0);

    // ── A direct/copied record link carries no captured list context — Back falls back to the
    //    bare owning index. ─────────────────────────────────────────────────────────────────
    await page.setViewportSize({ width: 1280, height: 800 });
    const freshPage = await page.context().newPage();
    await freshPage.goto(recordUrl);
    await expect(freshPage.getByTestId('record-header')).toContainText(titleB, { timeout: 15_000 });
    await freshPage
      .getByRole('navigation', { name: /breadcrumb/i })
      .getByRole('button', { name: /^meetings$/i })
      .click();
    await expect(freshPage).toHaveURL(/\/meetings$/, { timeout: 10_000 });
    await freshPage.close();
  } finally {
    for (const id of createdIds) {
      await deleteMeeting(page, id).catch(() => undefined);
    }
  }
});
