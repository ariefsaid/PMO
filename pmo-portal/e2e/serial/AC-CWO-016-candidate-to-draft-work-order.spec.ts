// @e2e-isolation: serial — the assessment checklist is an organisation-wide setting; the journey saves two items and removes them again.
// AC-CWO-016 (#2595): the project manager opens a candidate under their contract, passes the organisation's checks, accepts it with a reason,
// and the page shows the decision and links the new Draft work order.
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { signIn } from '../helpers';
import { cleanupAll, need, ORG_ID, PM_ID, runId, serviceClient } from '../support/jobFixtures';
import { userClient } from '../support/stockFixture';

test.setTimeout(120_000);

let admin: SupabaseClient;
let projectId = ''; let templateIds: string[] = []; let candidateIds: string[] = []; let workOrderIds: string[] = [];

test.afterEach(async () => {
  if (!admin) return;
  const { data } = projectId ? await admin.from('work_order_candidates').select('id, work_order_id').eq('project_id', projectId) : { data: [] as { id: string; work_order_id: string | null }[] };
  candidateIds = (data ?? []).map((c) => c.id);
  workOrderIds = (data ?? []).map((c) => c.work_order_id).filter((x): x is string => Boolean(x));
  await cleanupAll(admin, [
    ['work_order_candidates', 'id', candidateIds],
    ['work_orders', 'id', workOrderIds],
    ['work_order_checklist_items', 'id', templateIds],
    ['projects', 'id', projectId ? [projectId] : []],
  ]);
  projectId = ''; templateIds = []; candidateIds = []; workOrderIds = [];
});

test('AC-CWO-016 AC-WAIT-074 a project manager assesses a candidate, accepts it with a reason, and reaches the new Draft work order', async ({ page }) => {
  admin = serviceClient('AC-CWO-016');
  const run = runId('CWO');
  projectId = need('project', await admin.from('projects').insert({
    org_id: ORG_ID, name: `${run} contract`, status: 'Ongoing Project', currency: 'USD', project_manager_id: PM_ID,
  }).select('id').single()).id as string;
  const items = need('template', await admin.from('work_order_checklist_items').insert([
    { org_id: ORG_ID, label: `${run} first check`, position: 1, required: true },
    { org_id: ORG_ID, label: `${run} second check`, position: 2, required: true },
  ]).select('id'));
  templateIds = items.map((i: { id: string }) => i.id);

  await signIn(page, 'pm@acme.test');
  await page.goto(`/projects/${projectId}/contract`);
  await page.getByRole('button', { name: 'New candidate' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title').fill(`${run} pipe repair`);
  await dialog.getByRole('button', { name: 'Open candidate' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 });

  const card = page.getByRole('listitem').filter({ hasText: `${run} pipe repair` });
  await expect(card.getByText('0 of 2 required checks ready')).toBeVisible({ timeout: 20_000 });
  await expect(card.getByRole('button', { name: 'Accept' })).toBeDisabled();

  const results = card.getByRole('combobox', { name: 'Result' });
  await results.nth(0).selectOption('passed');
  await expect(card.getByText('1 of 2 required checks ready')).toBeVisible({ timeout: 20_000 });
  await results.nth(1).selectOption('passed');
  await expect(card.getByText('2 of 2 required checks ready')).toBeVisible({ timeout: 20_000 });

  await card.getByRole('button', { name: 'Accept' }).click();
  const reason = page.getByRole('alertdialog').or(page.getByRole('dialog'));
  await reason.getByRole('textbox').fill('Checks complete');
  await reason.getByRole('button', { name: 'Accept' }).click();

  await expect(card.getByText('Accepted because')).toBeVisible({ timeout: 20_000 });
  await expect(card.getByText('Checks complete')).toBeVisible();
  await card.getByRole('link', { name: 'Open the draft work order' }).click();
  await expect(page).toHaveURL(/\/work-orders\/[0-9a-f-]{36}$/);
  await expect(page.getByText(`${run} pipe repair`).first()).toBeVisible({ timeout: 20_000 });

  // AC-WAIT-074: once another hand prices the new Draft, the detail page names the exact person the issue step is
  // assigned to — this project's own manager — with their role, not a generic "Waiting" label.
  const workOrderId = page.url().split('/').pop()!;
  const adminClient = await userClient('admin@acme.test');
  const priced = await adminClient.rpc('set_work_order_value', {
    p_id: workOrderId, p_value: 3000, p_tax_treatment: 'exclusive', p_tax_amount: 0,
  });
  expect(priced.error).toBeNull();
  await page.reload();
  await expect(page.getByTestId('wo-issue-waiting')).toContainText('Diego Salvatierra', { timeout: 20_000 });
  await expect(page.getByTestId('wo-issue-waiting')).toContainText('Project Manager');
  expect(await page.getByTestId('wo-issue-waiting').textContent()).toMatch(/^Waiting for /);
});
