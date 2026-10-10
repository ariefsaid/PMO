// @e2e-isolation: read-only — rail/palette discovery of the PM's own task list; no DB writes.
import { test, expect, type Page } from '@playwright/test';
import { signIn } from './helpers';

/**
 * Pin the interface language WITHOUT a persisted profile write: I18nProvider
 * resolves the language ONLY from the signed-in profile (FR-L10N-003), so the
 * pass rewrites the profile row the AuthProvider reads (`select=*&id=eq.<uid>`,
 * single object) to carry `locale: 'en'`. Read-only + parallel-safe, and immune
 * to another session having drifted the shared local profile's saved locale.
 */
async function forceEnglish(page: Page) {
  await page.route('**/rest/v1/profiles?*', async (route) => {
    const url = route.request().url();
    if (route.request().method() !== 'GET' || !/[?&]id=eq\./.test(url)) return route.fallback();
    const response = await route.fetch();
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return route.fulfill({ response });
    }
    if (body && !Array.isArray(body) && typeof body === 'object' && 'locale' in body) {
      body = { ...(body as Record<string, unknown>), locale: 'en', number_locale: 'en-US' };
    }
    return route.fulfill({ response, json: body });
  });
}

/**
 * UXS-007 (2026-10-10 owner ruling): a Project Manager with assigned work can
 * discover their assignee-scoped My Tasks list WITHOUT knowing a URL — via the
 * rail entry and the ⌘K palette — while Executive navigation stays unchanged and
 * project Tasks remain the oversight destination.
 *
 * Journey: sign in as the seeded PM (pm@acme.test), find "My Tasks" in the rail,
 * follow it to /my-tasks, and see own assigned in-progress work. Then open the
 * palette, find the same destination by typing part of its name, and land on the
 * same route. Finally, an Executive sees neither the rail item nor the palette
 * destination.
 *
 * Task choice: "PROC — Panel & Inverter Procurement" — an In-Progress seed task
 * assigned to pm@acme.test that no other spec mutates (the AC-SCA-014 dedicated
 * row is reserved by its own spec; Done rows are outside the default Open view).
 *
 * Owning layer: e2e (Playwright) — UXS-007. Rail/palette/breadcrumb vocabulary
 * pins live in the shell unit suites; this journey proves the rendered discovery.
 */

const PM_TASK = 'PROC — Panel & Inverter Procurement';

test.describe('UXS-007: PM discovers assigned work without typing a URL', () => {
  test('rail entry leads to the assignee-scoped list with its cross-project meaning', async ({ page }) => {
    await forceEnglish(page);
    await signIn(page, 'pm@acme.test');

    // Discover: the rail names the personal doorway — no URL knowledge required.
    const rail = page.getByRole('navigation', { name: /primary navigation/i });
    const myTasksLink = rail.getByRole('link', { name: /my tasks/i });
    await expect(myTasksLink).toBeVisible({ timeout: 10_000 });

    // The hint states the assignee-scoped meaning so the entry is not mistaken
    // for org-wide or project oversight navigation.
    await expect(page.locator('#rail-my-tasks-hint')).toHaveText(
      'Your assigned work across projects',
    );

    // Follow it: the assignee-scoped list renders the PM's own in-progress work.
    // (Two seed projects carry identically-named tasks assigned to the PM — the
    // assert is on the PM's own work being present, not on one specific row.)
    await myTasksLink.click();
    await expect(page).toHaveURL(/\/my-tasks$/);
    await expect(
      page.getByRole('link', { name: 'PROC — Panel & Inverter Procurement' }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // Project oversight is a separate destination — the project-scoped Tasks
    // surface stays reachable through Projects, not merged into this list.
    await expect(rail.getByRole('link', { name: 'Projects', exact: true })).toBeVisible();
  });

  test('⌘K palette finds the same destination with its meaning stated', async ({ page }) => {
    await forceEnglish(page);
    await signIn(page, 'pm@acme.test');

    const dialog = page.getByRole('dialog', { name: /command palette/i });
    await expect(async () => {
      if (!(await dialog.isVisible())) {
        await page.keyboard.press('ControlOrMeta+k');
      }
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });

    await page.getByRole('combobox').fill('my tasks');
    const option = page.getByRole('option', { name: /My Tasks/i });
    await expect(option).toBeVisible();
    await expect(option).toHaveText(/Your assigned work across projects/);

    await page.keyboard.press('Enter');
    await page.waitForURL('**/my-tasks');
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('link', { name: 'PROC — Panel & Inverter Procurement' }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('Executive navigation is unchanged by the PM doorway', async ({ page }) => {
    await forceEnglish(page);
    await signIn(page, 'exec@acme.test');

    const rail = page.getByRole('navigation', { name: /primary navigation/i });
    await expect(rail.getByRole('link', { name: /my tasks/i })).toHaveCount(0);

    const dialog = page.getByRole('dialog', { name: /command palette/i });
    await expect(async () => {
      if (!(await dialog.isVisible())) {
        await page.keyboard.press('ControlOrMeta+k');
      }
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await expect(page.getByRole('option', { name: /My Tasks/i })).toHaveCount(0);
  });
});
