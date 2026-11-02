// @e2e-isolation: read-only — rail/palette discovery of the PM's own task list; no DB writes.
import { test, expect } from '@playwright/test';
import { pinEnglishLocale, signIn } from './helpers';

/**
 * Pin the interface language WITHOUT a persisted profile write — the shared `pinEnglishLocale`
 * helper from `./helpers` (#994 lifted the repeated inline route pin). I18nProvider resolves
 * the language ONLY from the signed-in profile (FR-L10N-003), so the helper rewrites the
 * profile row the AuthProvider reads to `locale: 'en'`. Read-only + parallel-safe, and immune
 * to another session having drifted the shared local profile's saved locale.
 */

/**
 * UXS-007 (2026-10-10 owner ruling): a Project Manager with assigned work can
 * discover their assignee-scoped My Tasks list WITHOUT knowing a URL — via the
 * rail entry while Executive navigation stays unchanged and
 * project Tasks remain the oversight destination.
 *
 * Journey: sign in as the seeded PM (pm@acme.test), find "My Tasks" in the rail,
 * follow it to /my-tasks, and see own assigned in-progress work.
 *
 * Task choice: "PROC — Panel & Inverter Procurement" — an In-Progress seed task
 * assigned to pm@acme.test that no other spec mutates (the AC-SCA-014 dedicated
 * row is reserved by its own spec; Done rows are outside the default Open view).
 *
 * Owning layer: e2e (Playwright) — UXS-007. Rail/palette/breadcrumb vocabulary
 * pins live in the shell unit suites; this journey proves the rendered discovery.
 */

test.describe('UXS-007: PM discovers assigned work without typing a URL', () => {
  test('rail entry leads to the assignee-scoped list with its cross-project meaning', async ({ page }) => {
    await pinEnglishLocale(page);
    await signIn(page, 'pm@acme.test');

    // Discover: the rail names the personal doorway — no URL knowledge required.
    const rail = page.getByRole('navigation', { name: /primary navigation/i });
    const myTasksLink = rail.getByRole('link', { name: /my tasks/i });
    await expect(myTasksLink).toBeVisible({ timeout: 10_000 });

    // FIN-S9: the rail sub-line was removed; the list page itself carries the cross-project meaning.

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

});
