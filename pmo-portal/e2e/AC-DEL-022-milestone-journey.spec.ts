import { test, expect } from '@playwright/test';
import { login } from './helpers';

// AC-DEL-022 — PM creates a milestone, adds a task under it, marks it Done.
//
// ISOLATION: acts exclusively on P013 "Seabridge Terminal Delivery"
// (40000000-0000-0000-0000-000000000013) — a dedicated, expendable Ongoing Project seed row
// with ZERO milestones so this journey exercises the create-from-empty path. No other spec
// reads P013. Run after `supabase db reset` so P013 is pristine.
//
// Journey (FR-DEL-001 through FR-DEL-017, end-to-end):
//  1. PM navigates directly to P013 detail page.
//  2. Milestone strip is empty → PM clicks "Add a milestone", fills name + weight, saves.
//  3. PM navigates to Tasks tab → within "Engineering design" group clicks "Add task",
//     creates "Detail drawings" (milestone pre-populated), saves.
//  4. PM marks "Detail drawings" Done via the status select.
// GOAL ORACLE:
//  - Milestone strip shows "Engineering design" with "From tasks" = 100%.
//  - Navigate to /projects — Seabridge row shows delivery-% chip reading "100%".

test.setTimeout(120_000);

const PROJECT_ID = '40000000-0000-0000-0000-000000000013';
const PROJECT_NAME = 'Seabridge Terminal Delivery';
const MILESTONE_NAME = 'Engineering design';
const TASK_NAME = 'Detail drawings';

test('AC-DEL-022: a PM creates a milestone, adds a task under it, marks it Done — the strip shows From-tasks 100% and the Projects list chip shows 100%', async ({ page }) => {
  await login(page, 'pm@acme.test');

  // ── Step 1: navigate directly to P013 detail page ────────────────────────────
  await page.goto(`/projects/${PROJECT_ID}`);
  await expect(page).toHaveURL(new RegExp(PROJECT_ID), { timeout: 15_000 });

  // Wait for the page to finish loading (loading skeleton clears).
  await expect(page.getByTestId('liststate-loading')).not.toBeVisible({ timeout: 20_000 });

  // ── Step 2: milestone strip is empty — add a milestone ───────────────────────
  // The strip shows the empty state with an "Add a milestone" CTA.
  await expect(page.getByTestId('milestone-strip-loading')).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('milestone-strip-empty')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: /Add a milestone/i }).click();

  // MilestoneFormModal opens (EntityFormModal renders a dialog).
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 15_000 });

  await dialog.getByLabel(/milestone name/i).fill(MILESTONE_NAME);
  // Weight defaults to 1 — leave it; no target date needed for this journey.

  // Submit — button label is "Create milestone".
  await dialog.getByRole('button', { name: /Create milestone/i }).click();

  // Modal closes and the strip now shows the new milestone.
  await expect(dialog).not.toBeVisible({ timeout: 15_000 });
  // Wait for the milestone name to appear in the strip (title attribute on the name span).
  await expect(page.getByTitle(MILESTONE_NAME)).toBeVisible({ timeout: 15_000 });

  // ── Step 3: navigate to Tasks tab, add a task under the milestone group ───────
  await page.getByRole('tab', { name: /tasks/i }).click();

  // Wait for the milestone group to appear (AC-DEL-010).
  const group = page.getByRole('region', { name: MILESTONE_NAME });
  await expect(group).toBeVisible({ timeout: 15_000 });

  // Click "Add task" inside the Engineering design group.
  await group.getByRole('button', { name: /Add task/i }).click();

  // TaskFormModal opens.
  const taskDialog = page.getByRole('dialog');
  await expect(taskDialog).toBeVisible({ timeout: 10_000 });

  await taskDialog.getByLabel(/task name/i).fill(TASK_NAME);
  // Milestone is pre-populated — assert it and leave it (AC-DEL-011).
  await expect(taskDialog.getByRole('combobox', { name: /milestone/i })).toContainText(
    MILESTONE_NAME,
    { timeout: 10_000 },
  );

  // Submit — button label is "Create task".
  await taskDialog.getByRole('button', { name: /Create task/i }).click();
  await expect(taskDialog).not.toBeVisible({ timeout: 15_000 });

  // The task row appears in the group (the task name span in the table cell).
  await expect(group.getByRole('cell').filter({ hasText: TASK_NAME }).first()).toBeVisible({ timeout: 15_000 });

  // ── Step 4: mark "Detail drawings" Done ─────────────────────────────────────
  // The status cell is a <select> labelled "Status for {task.name}".
  const statusSelect = page.getByLabel(`Status for ${TASK_NAME}`);
  await expect(statusSelect).toBeVisible({ timeout: 10_000 });
  await statusSelect.selectOption('Done');

  // Wait for the mutation to commit (query re-fetch propagates back to the milestone strip).
  await expect(statusSelect).toHaveValue('Done', { timeout: 10_000 });

  // ── GOAL ORACLE part 1: milestone strip "From tasks" = 100% ──────────────────
  // The milestone row in the strip (above the Tasks tab) shows "From tasks" = 100%.
  // Allow time for the TanStack Query invalidation to re-fetch the milestone strip data.
  const fromTasksLabel = page.getByLabel('From tasks');
  await expect(fromTasksLabel.getByText('100%')).toBeVisible({ timeout: 20_000 });

  // ── GOAL ORACLE part 2: Projects list shows delivery chip 100% ───────────────
  await page.goto('/projects');
  await expect(page.getByTestId('projects-loading')).not.toBeVisible({ timeout: 15_000 });

  // The Seabridge row has a DeliveryPctChip with aria-label="Delivery 100%".
  const seabridgeRow = page.getByRole('row').filter({ hasText: PROJECT_NAME });
  await expect(seabridgeRow).toBeVisible({ timeout: 15_000 });
  await expect(seabridgeRow.getByLabel('Delivery 100%')).toBeVisible({ timeout: 20_000 });
});
