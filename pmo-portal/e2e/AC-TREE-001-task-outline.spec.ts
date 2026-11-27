// @e2e-isolation: self-isolated — owns a project, its task group and its tasks (unique names), deleted in afterEach; no seed row is touched.
/** AC-TREE-001 (#2807) — a project manager plans in place: adds a task group from the task view, adds a task in it
 *  with two subtasks (one with its own subtask) in ONE save, sees the indented outline with the parent's roll-up,
 *  folds and unfolds it, moves a subtask under its sibling, and finds the same structure on the timeline. */
import { test, expect, type Locator, type Page } from '@playwright/test';
import { signIn } from './helpers';
import { serviceClient, ownProject, dropProject, uniq, PM_ID } from './support/jobFixtures';

test.setTimeout(150_000);

const admin = serviceClient('AC-TREE-001');
let projectId = '';
test.beforeEach(async () => { projectId = await ownProject(admin, `AC-TREE-001 project ${uniq()}`, PM_ID); });
test.afterEach(async () => { await dropProject(admin, projectId, ['tasks', 'task_groups']); });

const rowOf = (page: Page, name: string) =>
  page.locator('table tbody tr').filter({ has: page.getByRole('button', { name: `Open task ${name}`, exact: true }) });

/** Types a subtask row: its name, then its due date in the same row. */
async function fillSubtask(row: Locator, name: string, due: string) {
  await row.getByRole('textbox', { name: 'Subtask name' }).fill(name);
  await row.getByLabel('Due date').fill(due);
  await row.getByLabel('Due date').press('Tab');
}

test('AC-TREE-001 a project manager builds a group, a task and nested subtasks in place and sees one outline in the list and the timeline', async ({ page }) => {
  const group = `Site works ${uniq()}`;
  const parent = `Foundations ${uniq()}`;
  const subA = `Excavate ${uniq()}`;
  const subB = `Pour ${uniq()}`;
  const subB1 = `Rebar ${uniq()}`;
  await signIn(page, 'pm@acme.test');
  await page.goto(`/projects/${projectId}/tasks`);
  await expect(page.getByRole('button', { name: /new task/i }).first()).toBeVisible({ timeout: 20_000 });

  // A group, added without leaving the task view.
  await page.getByRole('button', { name: 'Add group', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Task group' }).click();
  const groupDialog = page.getByRole('dialog', { name: 'New task group' });
  await groupDialog.getByLabel('Group name').fill(group);
  await groupDialog.getByRole('button', { name: 'Create group' }).click();
  await expect(groupDialog).toBeHidden({ timeout: 15_000 });
  const groupHeader = page.locator('table tbody tr').filter({ hasText: group });
  await expect(groupHeader).toBeVisible({ timeout: 15_000 });

  // A task in that group with two subtasks, the second with its own subtask: one form, one save.
  await groupHeader.getByRole('button', { name: 'Add task' }).click();
  const dialog = page.getByRole('dialog', { name: 'New task' });
  await dialog.getByLabel('Task name').fill(parent);
  const subtasks = dialog.getByRole('group', { name: 'Subtasks' });
  await subtasks.getByRole('button', { name: 'Add subtask', exact: true }).click();
  await subtasks.getByRole('button', { name: 'Add subtask', exact: true }).click();
  const rows = subtasks.locator('li');
  await fillSubtask(rows.nth(0), subA, '10 Jan 2027');
  await fillSubtask(rows.nth(1), subB, '20 Jan 2027');
  await subtasks.getByRole('button', { name: `Add a subtask under ${subB}` }).click();
  await fillSubtask(subtasks.locator('li li').first(), subB1, '15 Feb 2027');
  // A task with subtasks takes its status and dates from them, and says so.
  await expect(dialog.getByTestId('task-form-rollup-note')).toBeVisible();
  await dialog.getByRole('button', { name: 'Create task' }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });

  // The outline: the parent in the group, two subtasks one level in, the nested one two levels in.
  await expect(rowOf(page, parent)).toBeVisible({ timeout: 15_000 });
  await expect(rowOf(page, subA)).toContainText('Subtask, level 1');
  await expect(rowOf(page, subB)).toContainText('Subtask, level 1');
  await expect(rowOf(page, subB1)).toContainText('Subtask, level 2');
  // The parent shows its roll-up: the span of its subtasks and their progress, never a status of its own.
  await expect(rowOf(page, parent)).toContainText('10 Jan 2027 – 15 Feb 2027');
  await expect(rowOf(page, parent).getByRole('progressbar')).toBeVisible();

  // Fold and unfold the parent.
  await rowOf(page, parent).getByRole('button', { name: `Hide subtasks of ${parent}` }).click();
  await expect(rowOf(page, subA)).toHaveCount(0);
  await rowOf(page, parent).getByRole('button', { name: `Show subtasks of ${parent}` }).click();
  await expect(rowOf(page, subA)).toBeVisible();

  // Move a subtask under its sibling: it goes one level deeper.
  await rowOf(page, subA).hover();
  await rowOf(page, subA).getByRole('button', { name: 'Row actions' }).click();
  await page.getByRole('menuitem', { name: 'Move…' }).click();
  const move = page.getByRole('dialog', { name: `Move ${subA}` });
  await move.getByRole('combobox', { name: 'Under task' }).click();
  await page.getByRole('option', { name: subB, exact: true }).click();
  await move.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(move).toBeHidden({ timeout: 15_000 });
  await expect(rowOf(page, subA)).toContainText('Subtask, level 2', { timeout: 15_000 });

  // The timeline carries the same structure: the group, the parent and its subtasks as rows.
  await page.goto(`/projects/${projectId}/tasks?view=timeline`);
  const figure = page.getByRole('figure');
  await expect(figure.getByText(group, { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(figure.getByText(parent, { exact: true }).first()).toBeVisible();
  await expect(figure.getByText(subB1, { exact: true }).first()).toBeVisible();
});
