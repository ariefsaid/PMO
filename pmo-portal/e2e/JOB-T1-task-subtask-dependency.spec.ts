// @e2e-isolation: self-isolated — owns a project, its tasks, two subtasks and a dependency (unique names), plus a disposable project-manager login; deleted in afterEach.
/** JOB-T1 / TC-PA-18 — a project manager, signed in as the job role itself, adds a task with two subtasks and a
 *  dependency, then opens the board and the timeline: both views show the work. */
import { test, expect, type Page } from '@playwright/test';
import { pickComboboxOption } from './helpers';
import { serviceClient, ownProject, dropProject, uniq, runId } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(150_000);

const admin = serviceClient('JOB-T1');
let projectId = '';
let worker: Awaited<ReturnType<typeof roleJobUser>>;

test.afterEach(async () => {
  if (projectId) await dropProject(admin, projectId, ['task_dependencies', 'tasks']);
  await worker?.cleanup();
  projectId = '';
});

async function newTask(
  page: Page,
  name: string,
  opts: { assignee?: RegExp; dates?: [string, string]; subtasks?: { name: string; assignee: string }[] } = {},
) {
  await page.getByRole('button', { name: /new task/i }).first().click();
  const dialog = page.getByRole('dialog', { name: /new task/i });
  await dialog.getByLabel(/task name/i).fill(name);
  if (opts.assignee) await pickComboboxOption(dialog, page, /assignee/i, opts.assignee);
  if (opts.dates) {
    await dialog.getByLabel(/start date/i).fill(opts.dates[0]);
    await dialog.getByLabel(/due date/i).fill(opts.dates[1]);
  }
  // #2807: a subtask is typed in its parent's form and saved with it.
  for (const subtask of opts.subtasks ?? []) {
    const subtasks = dialog.getByRole('group', { name: 'Subtasks' });
    await subtasks.getByRole('button', { name: 'Add subtask', exact: true }).click();
    await subtasks.getByRole('textbox', { name: 'Subtask name' }).last().fill(subtask.name);
    await subtasks.getByRole('combobox', { name: 'Assignee' }).last().selectOption({ label: subtask.assignee });
  }
  await dialog.getByRole('button', { name: /create task/i }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: `Open task ${name}`, exact: true })).toBeVisible({ timeout: 15_000 });
}

test('JOB-T1 a task with two subtasks and a dependency shows on the board and the timeline', async ({ page }) => {
  const sfx = uniq();
  worker = await roleJobUser(admin, 'project_manager', runId('t1'));
  projectId = await ownProject(admin, `JOB-T1 project ${sfx}`);
  const parent = `Parent ${sfx}`;
  const childOne = `Child one ${sfx}`;
  const childTwo = `Child two ${sfx}`;
  const after = `After ${sfx}`;

  await worker.signIn(page);
  await page.goto(`/projects/${projectId}/tasks`);
  await expect(page.getByRole('button', { name: /new task/i }).first()).toBeVisible({ timeout: 20_000 });

  await newTask(page, parent, {
    dates: ['2026-12-01', '2026-12-10'],
    subtasks: [{ name: childOne, assignee: 'Tomas Beck' }, { name: childTwo, assignee: 'Tomas Beck' }],
  });
  await newTask(page, after, { dates: ['2026-12-11', '2026-12-15'] });

  // The subtasks sit under their parent, one level in, each with its own assignee.
  for (const child of [childOne, childTwo]) {
    const childRow = page.locator('table tbody tr').filter({ has: page.getByRole('button', { name: `Open task ${child}`, exact: true }) });
    await expect(childRow).toContainText('Subtask, level 1');
    await expect(childRow).toContainText('Tomas Beck');
  }

  // The later task depends on the parent.
  const afterRow = page.locator('table tbody tr').filter({ has: page.getByRole('button', { name: `Open task ${after}`, exact: true }) });
  await afterRow.hover();
  await afterRow.getByRole('button', { name: 'Row actions' }).click();
  await page.getByRole('menuitem', { name: /^edit$/i }).click();
  const dialog = page.getByRole('dialog', { name: /edit task/i });
  await dialog.getByRole('combobox', { name: /add a dependency/i }).click();
  await page.getByRole('option', { name: new RegExp(parent) }).click();
  await expect(dialog.getByRole('listitem').filter({ hasText: parent })).toBeVisible();
  await dialog.getByRole('button', { name: /save task/i }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });

  await page.goto(`/projects/${projectId}/tasks`);
  await page.getByRole('button', { name: `Open task ${after}`, exact: true }).click();
  await expect(page.getByText('Depends on').locator('..')).toContainText(parent, { timeout: 15_000 });
  await page.getByRole('button', { name: /close/i }).first().click();

  // Board: both subtasks are cards in their status column.
  await page.getByRole('tab', { name: 'Board' }).click();
  const todo = page.getByTestId('task-col-To Do');
  for (const child of [childOne, childTwo]) {
    await expect(todo.getByRole('button', { name: `Open task ${child}`, exact: true })).toBeVisible({ timeout: 15_000 });
  }

  // Timeline: the same work is on the chart, including the parent and the task that depends on it.
  await page.getByRole('tab', { name: 'Timeline' }).click();
  const timeline = page.getByRole('figure', { name: /Task Gantt timeline/i });
  await expect(timeline).toBeVisible({ timeout: 20_000 });
  for (const name of [childOne, childTwo, parent, after]) {
    await expect(timeline.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  }
});
