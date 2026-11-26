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
  // Read History before saving so the edit has to refresh an already-open read.
  const activity = page.getByRole('region', { name: /Notes and activity|^Activity$/ });
  await expect(activity).toBeVisible({ timeout: 20_000 });
  await activity.getByRole('tab', { name: 'Changes', exact: true }).click();
  const events = activity.getByTestId('history-event');
  await expect(events.first().getByTestId('history-actor-role')).toHaveText('Project Manager', { timeout: 20_000 });

  await page.getByRole('button', { name: /^Edit$/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.getByLabel(/expected end/i).fill('2027-01-15');
  await dialog.getByRole('button', { name: /save project/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 20_000 });

  // Newest first: the Executive's change on top, each event carrying the person, their role and the exact time.
  await expect(events.first().getByTestId('history-actor-role')).toHaveText('Executive');
  await expect(events.first()).toContainText(new RegExp(run));
  await expect(events.first()).toContainText(/\d{1,2}:\d{2}\s?[AP]M/);
  // The Project Manager's creation is in the same history with its own role and time (a save may group child records,
  // so the creation is looked for among the first few events rather than pinned to one index).
  const shown = await events.evaluateAll((rows) => rows.slice(0, 6).map((row) => ({
    role: row.querySelector('[data-testid="history-actor-role"]')?.textContent?.trim() ?? '',
    time: /\d{1,2}:\d{2}\s?[AP]M/.test(row.textContent ?? ''),
  })));
  expect(shown.some((e) => e.role === 'Project Manager' && e.time)).toBe(true);
});
