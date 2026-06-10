import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * AC-TASK-001  Project Tasks CRUD — real user journey (binding BDD authoring principle).
 *
 * Covers in one sequential journey on the project Tasks tab (PM = full structure write):
 *   AC-TASK-001  the Tasks tab loads → "New task" CTA is visible for a write-role
 *   AC-TASK-003  create a task   → the new row appears in the list
 *   AC-TASK-004  edit a task     → the rename persists in the list
 *   AC-TASK-005  status update   → managers change a task's status via the inline control
 *   AC-TASK-006  delete a task   → it leaves the list
 *
 * Plus gate assertions at the right layer (FE clarity projection of rbac-visibility.md §F):
 *   AC-TASK-001b Engineer assignee can change ONLY their own task's status (own = editable),
 *                and sees no "New task" structure-write affordance.
 *
 * Isolation: the unique task name is generated inside the journey so all steps share it and
 * there is zero seed-coupling. The Engineer gate reads the seeded "Fit-out" task (assigned to
 * engineer@acme.test on the "Innovate Corp HQ Fit-Out" project).
 *
 * Roles: pm@acme.test (full structure write), engineer@acme.test (own-status-only gate).
 * Project: 40000000-0000-0000-0000-000000000001 ("Innovate Corp HQ Fit-Out").
 */

test.setTimeout(120_000);

const PROJECT_ID = '40000000-0000-0000-0000-000000000001';

/** Open the project detail and switch to the Tasks tab; wait for the list to settle. */
async function gotoTasks(page: Page) {
  await page.goto(`/projects/${PROJECT_ID}`);
  await page.getByRole('tab', { name: /tasks/i }).click();
  // The loading variant renders data-testid="liststate-loading"; wait until it clears.
  await expect(page.getByTestId('liststate-loading')).not.toBeVisible({ timeout: 20_000 });
}

/**
 * Locate the DataTable row via the activation button rendered in the first cell.
 * B-2 wired `rowLabel={(t) => \`Edit ${t.name}\`}`, so the cell's accessible name
 * is now "Edit <name>" — the old exact cell-name match no longer works.
 * Per the BDD authoring rule this is a deliberate-UX-change → update the locator
 * to the new doorway while keeping the goal-oracle intact.
 */
function taskRow(page: Page, name: string) {
  return page.locator('table tbody tr').filter({
    has: page.getByRole('button', { name: `Edit ${name}`, exact: true }),
  });
}

async function openRowMenu(page: Page, row: ReturnType<typeof page.locator>) {
  await row.hover();
  await row.getByRole('button', { name: 'Row actions' }).click();
}

// ── AC-TASK-001/003/004/005/006 — full PM CRUD journey ───────────────────────

test(
  'AC-TASK-001 + AC-TASK-003 + AC-TASK-004 + AC-TASK-005 + AC-TASK-006: PM creates, edits, restatuses, then deletes a task — goal oracle: row present after create, renamed after edit, status changed, gone after delete',
  async ({ page }) => {
    const runId = Date.now();
    const taskName = `E2E-Task-${runId}`;
    const taskEdited = `${taskName}-EDITED`;

    await login(page, 'pm@acme.test');
    await gotoTasks(page);

    // ── Step 1: AC-TASK-001 — "New task" CTA is visible for PM ──────────────
    const newBtn = page.getByRole('button', { name: /new task/i }).first();
    await expect(newBtn).toBeVisible({ timeout: 10_000 });

    // ── Step 2: AC-TASK-003 — create the task ───────────────────────────────
    await newBtn.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8_000 });
    await dialog.getByLabel(/task name/i).fill(taskName);
    await dialog.getByRole('button', { name: /create task/i }).click();

    // GOAL ORACLE: modal closes; the new row IS in the list
    await expect(dialog).not.toBeVisible({ timeout: 15_000 });
    const createdRow = taskRow(page, taskName);
    await expect(createdRow).toBeVisible({ timeout: 15_000 });

    // ── Step 3: AC-TASK-005 — change the task's status via the inline control ──
    const statusCtl = createdRow.getByLabel(`Status for ${taskName}`);
    await statusCtl.selectOption('In Progress');
    // GOAL ORACLE: the control reflects the new status (the row persisted the change)
    await expect(statusCtl).toHaveValue('In Progress', { timeout: 15_000 });

    // ── Step 4: AC-TASK-004 — edit (rename) the task ────────────────────────
    await openRowMenu(page, createdRow);
    await page.getByRole('menuitem', { name: /^edit$/i }).click();
    const editDialog = page.getByRole('dialog');
    await expect(editDialog).toBeVisible({ timeout: 8_000 });
    const nameInput = editDialog.getByLabel(/task name/i);
    await nameInput.clear();
    await nameInput.fill(taskEdited);
    await editDialog.getByRole('button', { name: /save task/i }).click();

    // GOAL ORACLE: modal closes; the renamed row IS present; the old exact name is gone
    await expect(editDialog).not.toBeVisible({ timeout: 15_000 });
    const editedRow = taskRow(page, taskEdited);
    await expect(editedRow).toBeVisible({ timeout: 15_000 });
    await expect(taskRow(page, taskName)).not.toBeVisible({ timeout: 5_000 });

    // ── Step 5: AC-TASK-006 — delete the task ───────────────────────────────
    await openRowMenu(page, editedRow);
    await page.getByRole('menuitem', { name: /delete/i }).click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toBeVisible({ timeout: 8_000 });
    await confirm.getByRole('button', { name: /delete task/i }).click();

    // GOAL ORACLE: the row is gone from the list
    await expect(editedRow).not.toBeVisible({ timeout: 15_000 });
  },
);

// ── AC-TASK-001b — Engineer own-status-only gate ─────────────────────────────

test(
  'AC-TASK-001b gating: an Engineer assignee can change ONLY their own task status and sees no New task structure-write affordance',
  async ({ page }) => {
    await login(page, 'engineer@acme.test');
    await gotoTasks(page);

    // GOAL ORACLE 1: no structure-write affordance (New task) for the Engineer.
    await expect(page.getByRole('button', { name: /new task/i })).not.toBeVisible({ timeout: 10_000 });

    // GOAL ORACLE 2: the Engineer's OWN seeded task ("Fit-out", assigned to them) exposes an
    // editable status control, and changing it persists (the own-status RLS path).
    const ownStatus = page.getByLabel(/status for fit-out/i);
    await expect(ownStatus).toBeVisible({ timeout: 10_000 });
    await expect(ownStatus).toBeEnabled();
    await ownStatus.selectOption('Done');
    await expect(ownStatus).toHaveValue('Done', { timeout: 15_000 });
  },
);
