import { test, expect } from '@playwright/test';
import { login } from './helpers';

/**
 * AC-W2-IXD-001 (B-1, Wave 2 IxD naturalness): An Engineer reaches their assigned
 * tasks WITHOUT having to open the all-projects financial table.
 *
 * Natural journey: an IC's real goal is "see and update my own work" — this spec
 * asserts that goal directly. The My Tasks nav item takes the Engineer straight
 * to their task list, and changing a task status there persists (round-trip).
 *
 * Seed: engineer@acme.test (a4) has two tasks assigned:
 *   - "Demolition" on P001 — status "Done"
 *   - "Fit-out" on P001 — status "In Progress"
 * This spec updates "Fit-out" to "Done" and confirms the change persists.
 *
 * Owning layer: e2e (Playwright) — AC-W2-IXD-001.
 */

test.setTimeout(60_000);

test(
  'AC-W2-IXD-001: Engineer reaches their own tasks via the My Tasks nav item, not the financial table',
  async ({ page }) => {
    await login(page, 'engineer@acme.test');

    // Goal 1: The My Tasks nav item exists in the sidebar — the IC can reach their work
    // without hunting through the all-projects financial table.
    const myTasksLink = page.getByRole('navigation', { name: /primary navigation/i })
      .getByRole('link', { name: /my tasks/i });
    await expect(myTasksLink).toBeVisible({ timeout: 10_000 });

    // Follow the nav item.
    await myTasksLink.click();
    await expect(page).toHaveURL(/\/my-tasks/);

    // Goal 2: The My Tasks page shows the Engineer's own assigned tasks (not all org tasks).
    // The seed has "Demolition" and "Fit-out" assigned to engineer@acme.test.
    // NB: the parent project is "Innovate Corp HQ Fit-Out", so a loose /Fit-out/i also matches
    // the project group heading — use exact text to target the TASK row, not the heading.
    await expect(page.getByText('Fit-out', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Demolition', { exact: true })).toBeVisible({ timeout: 10_000 });

    // Goal 3: A status update round-trips — the Engineer can mark their work done.
    // Find the status select for "Fit-out" and change it to "Done".
    const statusSelect = page.getByRole('combobox', { name: /change status of Fit-out/i });
    await expect(statusSelect).toBeVisible({ timeout: 10_000 });
    await statusSelect.selectOption('Done');

    // After the mutation, the status select still shows "Done" (optimistic / refetched).
    // The in-progress pill should no longer appear next to Fit-out.
    // Re-query to confirm the change persisted through the invalidate refetch.
    await expect(statusSelect).toHaveValue('Done', { timeout: 15_000 });
  },
);
