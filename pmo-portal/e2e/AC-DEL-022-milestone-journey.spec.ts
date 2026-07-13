// @e2e-isolation: dedicated-row — owns P013; beforeEach resets to empty (retry-safe).
import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { requireServiceRoleKey } from './helpers';
import { createClient } from '@supabase/supabase-js';

const P013 = '40000000-0000-0000-0000-000000000013';

test.beforeEach(async () => {
  const svcKey = requireServiceRoleKey();
  if (!svcKey) return; // local dev: skip (seed reset provides clean state)
  // The node test process gets SUPABASE_URL (exported by CI / e2e-local.sh); VITE_SUPABASE_URL is
  // only in .env.local for Vite. Prefer SUPABASE_URL, fall back to VITE_ (mirrors AC-CUA-090).
  const admin = createClient(process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL!, svcKey);
  // delete tasks under those milestones, then the milestones — so P013 is empty on every attempt
  const { data: ms } = await admin.from('project_milestones').select('id').eq('project_id', P013);
  const ids = (ms ?? []).map((m) => m.id);
  if (ids.length) {
    await admin.from('tasks').delete().in('milestone_id', ids);
    await admin.from('project_milestones').delete().eq('project_id', P013);
  }
});

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
//  - Milestone strip shows the "Engineering design" phase card reading 100% effective.
//  - Navigate to /projects — Seabridge row shows delivery progress reading "100%".

test.setTimeout(120_000);

const PROJECT_ID = '40000000-0000-0000-0000-000000000013';
const PROJECT_NAME = 'Seabridge Terminal Delivery';

test('AC-DEL-022: a PM creates a milestone, adds a task under it, marks it Done — the phase card reads 100% effective and the Projects list chip shows 100%', async ({ page }) => {
  // Retry-isolation: the milestone + task names are unique per attempt (runId is
  // recomputed when Playwright re-runs the body on a retry — CI retries=2 on the
  // shared DB). A milestone/task left behind by a flaked attempt-1 therefore can
  // never strict-mode-collide with this attempt's region/cell/phase-card assertions
  // — each scopes to a name no prior attempt used. (The milestone-strip EMPTY-state
  // step still requires a pristine P013, which a `supabase db reset` provides; that
  // precondition is a seed-reset dependency unique naming cannot remove — but a
  // leftover milestone no longer poisons the create/assert path below.)
  const runId = Date.now();
  const MILESTONE_NAME = `Engineering design ${runId}`;
  const TASK_NAME = `Detail drawings ${runId}`;

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

  // The empty strip now teaches the PM to plan phases; the primary doorway opens the same modal.
  await page.getByRole('button', { name: /Add the first phase/i }).click();

  // MilestoneFormModal opens (EntityFormModal renders a dialog).
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 15_000 });

  await dialog.getByLabel(/milestone name/i).fill(MILESTONE_NAME);
  // Weight defaults to 1 — leave it; no target date needed for this journey.

  // Submit — button label is "Create milestone".
  await dialog.getByRole('button', { name: /Create milestone/i }).click();

  // Modal closes and the strip now shows the new milestone.
  await expect(dialog).not.toBeVisible({ timeout: 15_000 });
  // Wait for the milestone name to appear in the redesigned stepper labels.
  await expect(page.getByText(MILESTONE_NAME).first()).toBeVisible({ timeout: 15_000 });

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

  // ── GOAL ORACLE part 1: milestone strip effective % = 100% ──────────────────
  // The redesigned stepper removed "From tasks" text; each phase card (<section>) now shows
  // the effective % as a large headline number on the right. With input_pct=null the effective %
  // equals the task-derived value, so asserting the "Engineering design" card reads 100% is the
  // full-strength equivalent oracle.
  const phaseCard = page.locator('section').filter({ hasText: MILESTONE_NAME });
  await expect(phaseCard.getByText('100%', { exact: true })).toBeVisible({ timeout: 20_000 });

  // ── GOAL ORACLE part 2: Projects list shows delivery chip 100% ───────────────
  await page.goto('/projects');
  await expect(page.getByTestId('projects-loading')).not.toBeVisible({ timeout: 15_000 });

  // The Seabridge row has a delivery progress bar with aria-label="Delivery 100%".
  const seabridgeRow = page.getByRole('row').filter({ hasText: PROJECT_NAME });
  await expect(seabridgeRow).toBeVisible({ timeout: 15_000 });
  await expect(seabridgeRow.getByLabel('Delivery 100%')).toBeVisible({ timeout: 20_000 });
});
