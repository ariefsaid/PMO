// @e2e-isolation: self-isolated — service-role inserts its own project and task and deletes both; no shared seed row is touched.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createClient } from '@supabase/supabase-js';
import { signIn, requireServiceRoleKey, visibleToast } from './helpers';
import { dragCardTo } from './support/boardDrag';

// AC-DND-015 / AC-DND-016 (#1637): drag a task card to another status column, real browser, real DB.
// A PM drags a self-created task from To Do to Done on the project Tasks board; the status is written
// with no confirm, the "Status updated" toast shows, and it is still in Done after a reload.

test.setTimeout(120_000);
test.use({ viewport: { width: 1800, height: 1000 } }); // four columns side by side

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';

const svcKey = requireServiceRoleKey();
if (!svcKey) {
  throw new Error('AC-DND-015: SUPABASE_SERVICE_ROLE_KEY is required for this owning journey (local fixture dependency) - it must not silently skip.');
}
const admin = createClient(SUPABASE_URL, svcKey, { auth: { persistSession: false } });

let PROJECT_ID: string;
let TASK_ID: string;
let TASK: string;

test.beforeEach(async () => {
  PROJECT_ID = crypto.randomUUID();
  TASK_ID = crypto.randomUUID();
  TASK = `DND task ${crypto.randomUUID().slice(0, 8)}`;
  const { error: projectError } = await admin.from('projects').insert({
    id: PROJECT_ID, org_id: ORG_ID, name: `DND 1637 tasks ${TASK}`, status: 'Ongoing Project',
    currency: 'USD', contract_value: 0, tax_treatment: 'exclusive', tax_amount: 0,
  });
  if (projectError) throw new Error(`AC-DND-015 seed project failed: ${projectError.message}`);
  const { error } = await admin.from('tasks').insert({
    id: TASK_ID, org_id: ORG_ID, project_id: PROJECT_ID, name: TASK, status: 'To Do',
  });
  if (error) throw new Error(`AC-DND-015 seed task failed: ${error.message}`);
});

test.afterEach(async () => {
  await admin.from('record_changes').delete().eq('entity_id', TASK_ID);
  await admin.from('tasks').delete().eq('id', TASK_ID);
  await admin.from('record_changes').delete().eq('entity_id', PROJECT_ID);
  await admin.from('projects').delete().eq('id', PROJECT_ID);
});

test('AC-DND-015 PM drags a task To Do → Done and it persists', async ({ page }) => {
  await signIn(page, 'pm@acme.test');
  await page.goto(`/projects/${PROJECT_ID}`);
  await page.getByRole('tab', { name: /tasks/i }).click();
  await page.getByRole('tab', { name: /^board$/i }).click();
  const toDo = page.getByTestId('task-col-To Do');
  const done = page.getByTestId('task-col-Done');
  const card = toDo.getByRole('button', { name: `Open task ${TASK}`, exact: true });
  await expect(card).toBeVisible({ timeout: 20_000 });

  // AC-DND-016: the idle board passes axe.
  const idle = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(idle.violations).toEqual([]);

  await dragCardTo(page, card, done, async () => {
    // AC-DND-016: axe passes mid-drag, and the card's own column carries no "can't move" cue.
    await expect(done.getByText('Drop to move here')).toBeVisible();
    await expect(toDo.getByText("Can't move here")).toHaveCount(0);
    await expect(toDo.getByText('Drop to move here')).toHaveCount(0);
    const midDrag = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(midDrag.violations).toEqual([]);
  });
  await expect(visibleToast(page, 'Status updated')).toBeVisible({ timeout: 15_000 });
  await expect(done.getByRole('button', { name: `Open task ${TASK}`, exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('task-col-Done').getByRole('button', { name: `Open task ${TASK}`, exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('task-col-To Do').getByText(TASK)).toHaveCount(0);
});
