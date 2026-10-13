// @e2e-isolation: dedicated-row — owns the seeded 'Fit-out' task and restores its original status before/after the journey.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { login, requireServiceRoleKey } from './helpers';

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const FIT_OUT_TASK_ID = '80000000-0000-0000-0000-000000000002';

async function restoreFitOutTask() {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('Service role key is required to restore the dedicated task fixture.');
  const admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  const { error } = await admin.from('tasks').update({ status: 'In Progress' }).eq('id', FIT_OUT_TASK_ID);
  if (error) throw error;
}

test.beforeEach(restoreFitOutTask);
test.afterEach(restoreFitOutTask);

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
    // The seed has "Demolition" (Done) and "Fit-out" (In Progress) assigned to engineer@acme.test.
    // The documented working-queue default hides completed work; completed access is verified below.
    // NB: the parent project is "Innovate Corp HQ Fit-Out", so a loose /Fit-out/i also matches
    // the project group heading — use exact text to target the TASK row, not the heading.
    await expect(page.getByText('Fit-out', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Demolition', { exact: true })).not.toBeVisible();

    // Goal 3: A status update round-trips — the Engineer can mark their work done.
    // Find the status select for "Fit-out" and change it to "Done".
    const statusSelect = page.getByRole('combobox', { name: /change status of Fit-out/i });
    await expect(statusSelect).toBeVisible({ timeout: 10_000 });
    await statusSelect.selectOption('Done');

    // Done leaves the default Open queue. Switch to the explicitly provided Completed queue
    // and assert both seeded completed work and the changed task are available there.
    await expect(page.getByRole('button', { name: 'Completed' })).toBeVisible();
    await page.getByRole('button', { name: 'Completed' }).click();
    await expect(page.getByText('Demolition', { exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: /change status of Fit-out/i })).toHaveValue('Done', { timeout: 15_000 });
  },
);
