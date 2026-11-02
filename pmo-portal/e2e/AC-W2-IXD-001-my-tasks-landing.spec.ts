// @e2e-isolation: self-isolated — service-role seeds one uniquely named In-Progress task assigned to engineer@acme.test per attempt and deletes it in afterEach; the shared 'Demolition' completed seed row is only read, never written.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { login, requireServiceRoleKey } from './helpers';

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';

/** The task row this attempt owns; set by the journey, deleted by the afterEach cleanup. */
let ownTaskId = '';

/** House pattern (AC-RMD-024 / AC-MTG-060): service-role setup + cleanup of the attempt's OWN
 *  uniquely-named row. #994: the journey no longer writes the shared seeded 'Fit-out' row. */
async function seedOwnTask(name: string): Promise<string> {
  const key = requireServiceRoleKey();
  if (!key) {
    throw new Error(
      'AC-W2-IXD-001 seeds its own task via service role: run it via scripts/e2e-local.sh, which exports the key',
    );
  }
  const admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  const { data: eng, error: engError } = await admin
    .from('profiles')
    .select('id, org_id')
    .eq('email', 'engineer@acme.test')
    .single();
  if (engError) throw engError;
  const { data: proj, error: projError } = await admin
    .from('projects')
    .select('id')
    .eq('org_id', eng!.org_id)
    .is('archived_at', null)
    .limit(1)
    .single();
  if (projError) throw projError;
  const { data: task, error } = await admin
    .from('tasks')
    .insert({ org_id: eng!.org_id, project_id: proj!.id, name, status: 'In Progress', assignee_id: eng!.id })
    .select('id')
    .single();
  if (error) throw error;
  return task!.id;
}

test.afterEach(async () => {
  if (!ownTaskId) return;
  const key = requireServiceRoleKey();
  if (!key) return; // local best-effort: the row is uniquely named and the next db reset clears it
  const admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  const { error } = await admin.from('tasks').delete().eq('id', ownTaskId);
  if (error) throw error;
  ownTaskId = '';
});

/**
 * AC-W2-IXD-001 (B-1, Wave 2 IxD naturalness): An Engineer reaches their assigned
 * tasks WITHOUT having to open the all-projects financial table.
 *
 * Natural journey: an IC's real goal is "see and update my own work" — this spec
 * asserts that goal directly. The My Tasks nav item takes the Engineer straight
 * to their task list, and changing a task status there persists (round-trip).
 *
 * Isolation (#994): the journey used to mark the shared seeded "Fit-out" row Done and
 * restore it — a shared-row write that collides with other engineer-adjacent journeys
 * under workers:4. It now seeds its OWN uniquely-named In-Progress task (service role,
 * per attempt) and keeps the seeded "Demolition" row (Done) as a READ-ONLY completed
 * seed check. The journey's goal oracle is unchanged.
 *
 * Owning layer: e2e (Playwright) — AC-W2-IXD-001.
 */

test.setTimeout(60_000);

test(
  'AC-W2-IXD-001: Engineer reaches their own tasks via the My Tasks nav item, not the financial table',
  async ({ page }) => {
    // Unique per ATTEMPT (AC-MTG-060 pattern): a retry never collides with attempt 1's row.
    const taskName = `AC-W2-IXD-001 my task ${Date.now()}`;
    ownTaskId = await seedOwnTask(taskName);

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
    // The attempt's own task is visible; the completed seed "Demolition" stays hidden by the
    // documented working-queue default (completed access is verified below). NB: exact text
    // targets the TASK row, not a project group heading.
    await expect(page.getByText(taskName, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Demolition', { exact: true })).not.toBeVisible();

    // Goal 3: A status update round-trips — the Engineer can mark their own work done.
    const statusSelect = page.getByRole('combobox', { name: new RegExp(`change status of ${taskName}`, 'i') });
    await expect(statusSelect).toBeVisible({ timeout: 10_000 });
    await statusSelect.selectOption('Done');

    // Done leaves the default Open queue. Switch to the explicitly provided Completed queue
    // and assert both the seeded completed work (read-only check) and the changed task are there.
    await expect(page.getByRole('button', { name: 'Completed' })).toBeVisible();
    await page.getByRole('button', { name: 'Completed' }).click();
    await expect(page.getByText('Demolition', { exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: new RegExp(`change status of ${taskName}`, 'i') })).toHaveValue('Done', { timeout: 15_000 });
  },
);
