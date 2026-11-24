// @e2e-isolation: self-isolated — owns two disposable logins (Project Manager and Executive), its own client and project; deletes them in finally.
// JOB-M7 (acceptance 01-management, TC-M-07): no shared logins, full history. One person creates the record, another
// changes it; the Executive then opens the record's History and every event names the person, their role, the date and
// the time. (The acceptance script says "approved by another"; the app records the second person's change the same way.)
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { pickComboboxOption } from './helpers';
import { need, ok, ORG_ID, runId, serviceClient } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(180_000);

type Actor = Awaited<ReturnType<typeof roleJobUser>>;
let admin: SupabaseClient;
let pm: Actor | undefined; let exec: Actor | undefined;
let companyId = ''; let projectId = '';

test.afterEach(async () => {
  if (!admin) return;
  if (projectId) {
    await admin.from('record_changes').delete().eq('entity_id', projectId);
    await admin.from('projects').delete().eq('id', projectId);
  }
  if (companyId) ok('client cleanup', await admin.from('companies').delete().eq('id', companyId));
  await exec?.cleanup();
  await pm?.cleanup();
  companyId = ''; projectId = ''; pm = undefined; exec = undefined;
});

test('JOB-M7 the Executive sees who created and who changed the record, each with role, date and time', async ({ page }) => {
  admin = serviceClient('JOB-M7');
  const run = runId('JOBM7');
  pm = await roleJobUser(admin, 'project_manager', `${run}-pm`);
  exec = await roleJobUser(admin, 'executive', `${run}-exec`);
  companyId = need('client', await admin.from('companies').insert({ org_id: ORG_ID, name: `${run} client`, type: 'Client' }).select('id').single()).id as string;
  const projectName = `${run} contract`;

  // The Project Manager creates the record.
  await pm.signIn(page);
  await page.goto('/projects');
  await page.getByRole('button', { name: /new project/i }).click();
  await page.getByLabel(/project name/i).fill(projectName);
  await pickComboboxOption(page, page, /client company/i, new RegExp(`${run} client`));
  await page.getByLabel(/expected end/i).fill('2026-12-30');
  await page.getByRole('button', { name: /^Create project$/i }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/u, { timeout: 20_000 });
  projectId = page.url().match(/\/projects\/([0-9a-f-]{36})/u)![1];

  // A second person changes it.
  await exec.signIn(page);
  await page.goto(`/projects/${projectId}`);
  await page.getByRole('button', { name: /^Edit$/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.getByLabel(/expected end/i).fill('2027-01-15');
  await dialog.getByRole('button', { name: /save project/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 20_000 });

  // The Executive opens the record's History: each event names the person, their role, date and time.
  const activity = page.getByRole('region', { name: /Notes and activity|^Activity$/ });
  await expect(activity).toBeVisible({ timeout: 20_000 });
  await activity.getByRole('button', { name: 'Changes', exact: true }).click();
  const events = activity.getByTestId('history-event');
  await expect(events.first()).toBeVisible({ timeout: 20_000 });

  // Newest first: the Executive's change, then the Project Manager's creation.
  const roleOf = (n: number) => events.nth(n).getByTestId('history-actor-role');
  await expect(roleOf(0)).toHaveText('Executive');
  await expect(events.nth(0)).toContainText(new RegExp(run));
  await expect(events.nth(0)).toContainText(/\d{1,2}:\d{2}\s?[AP]M/);
  await expect(events.nth(1)).toContainText(new RegExp(run));
  await expect(roleOf(1)).toHaveText('Project Manager');
  await expect(events.nth(1)).toContainText(/\d{1,2}:\d{2}\s?[AP]M/);
});
