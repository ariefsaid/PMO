// @e2e-isolation: self-isolated — owns a project and its tasks (unique names), deleted in afterEach; no seed row is touched.
/** JOB-T1 — a project manager adds a task, a subtask under it with another assignee, and a dependency; the subtask shows under its parent and the dependency is on the task.
 *  Partly landed: tasks, subtasks, assignees and dependencies exist; the rule "a dependent task cannot start before its predecessor is done" is not enforced (no refusal exists), so it is not asserted. */
import { test, expect, type Page } from '@playwright/test';
import { signIn, pickComboboxOption } from './helpers';
import { serviceClient, ownProject, dropProject, uniq } from './support/jobFixtures';

test.setTimeout(150_000);

const admin = serviceClient();
let projectId = '';
test.beforeEach(async () => { projectId = await ownProject(admin, `JOB-T1 project ${uniq()}`); });
test.afterEach(async () => { await dropProject(admin, projectId, ['task_dependencies', 'tasks']); });

async function newTask(page: Page, name: string, opts: { parent?: RegExp; assignee?: RegExp } = {}) {
  await page.getByRole('button', { name: /new task/i }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/task name/i).fill(name);
  if (opts.assignee) await pickComboboxOption(dialog, page, /assignee/i, opts.assignee);
  if (opts.parent) await pickComboboxOption(dialog, page, /parent task/i, opts.parent);
  await dialog.getByRole('button', { name: /create task/i }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: `Open task ${name}`, exact: true })).toBeVisible({ timeout: 15_000 });
}

test('JOB-T1 a project manager adds a task, a subtask with another assignee, and a dependency', async ({ page }) => {
  const parent = `Parent ${uniq()}`;
  const child = `Child ${uniq()}`;
  const after = `After ${uniq()}`;
  await signIn(page, 'pm@acme.test');
  await page.goto(`/projects/${projectId}/tasks`);
  await expect(page.getByRole('button', { name: /new task/i }).first()).toBeVisible({ timeout: 20_000 });

  await newTask(page, parent);
  await newTask(page, child, { parent: new RegExp(parent), assignee: /Tomas Beck/ });
  await newTask(page, after);

  // The subtask sits under its parent (one level in) and carries its own assignee.
  const childRow = page.locator('table tbody tr').filter({ has: page.getByRole('button', { name: `Open task ${child}`, exact: true }) });
  await expect(childRow).toContainText('Subtask, level 1');
  await expect(childRow).toContainText('Tomas Beck');

  // The later task is made to depend on the parent.
  const afterRow = page.locator('table tbody tr').filter({ has: page.getByRole('button', { name: `Open task ${after}`, exact: true }) });
  await afterRow.hover();
  await afterRow.getByRole('button', { name: 'Row actions' }).click();
  await page.getByRole('menuitem', { name: /^edit$/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: /add a dependency/i }).click();
  await page.getByRole('option', { name: new RegExp(parent) }).click();
  await expect(dialog.getByRole('listitem').filter({ hasText: parent })).toBeVisible();
  await dialog.getByRole('button', { name: /save task/i }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });

  await page.goto(`/projects/${projectId}/tasks`);
  await page.getByRole('button', { name: `Open task ${after}`, exact: true }).click();
  await expect(page.getByText('Depends on').locator('..')).toContainText(parent, { timeout: 15_000 });
});
