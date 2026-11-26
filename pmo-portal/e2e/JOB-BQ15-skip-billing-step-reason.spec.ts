// @e2e-isolation: self-isolated — creates its own client, project, work order and step list; deletes them in afterEach.
/**
 * JOB-BQ15 (billing lane): skipping an optional work-order billing step asks why. The billing officer skips the step, types the
 * reason, and reads it beside the skipped step (and again after a reload). Without a reason the step is not skipped.
 */
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ORG_ID, need, ok, runId, serviceClient } from './support/jobFixtures';
import { createJobRoleUser } from './support/jobRoleUser';
import { openWorkOrderArea } from './support/workOrderArea';

test.setTimeout(180_000);

let admin: SupabaseClient | undefined;
let projectId = '';
let workOrderId = '';
let companyId = '';
let users: Awaited<ReturnType<typeof createJobRoleUser>>[] = [];

test.beforeEach(async () => {
  admin = serviceClient('JOB-BQ15');
  const db = admin;
  const run = runId('bq15');
  companyId = need('client', await db.from('companies').insert({ org_id: ORG_ID, name: `${run} client`, type: 'Client' }).select('id').single()).id as string;
  projectId = need('project', await db.from('projects').insert({
    org_id: ORG_ID, name: run, status: 'Ongoing Project', currency: 'IDR', client_id: companyId, contract_value: 1_000_000,
    tax_treatment: 'exclusive', tax_amount: 0, tax_rate: 0, tax_base_numerator: 1, tax_base_denominator: 1,
  }).select('id').single()).id as string;
  workOrderId = crypto.randomUUID();
  ok('work order', await db.from('work_orders').insert({
    id: workOrderId, org_id: ORG_ID, project_id: projectId, title: `${run} order`, status: 'Issued', issued_at: new Date().toISOString(),
    order_value: 100_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'IDR',
  }));
  const today = new Date().toISOString().slice(0, 10);
  ok('steps', await db.from('work_order_billing_steps').insert([
    { org_id: ORG_ID, work_order_id: workOrderId, project_id: projectId, position: 1, name: 'Joint check', optional: true, started_on: today },
    { org_id: ORG_ID, work_order_id: workOrderId, project_id: projectId, position: 2, name: 'Invoice pack', optional: false },
  ]));
});

test.afterEach(async () => {
  if (!admin) return;
  const fail = (step: string, e: { message: string } | null) => { if (e) throw new Error(`JOB-BQ15 cleanup ${step}: ${e.message}`); };
  if (projectId) {
    fail('steps', (await admin.from('work_order_billing_steps').delete().eq('project_id', projectId)).error);
    fail('work order', (await admin.from('work_orders').delete().eq('id', workOrderId)).error);
    fail('project', (await admin.from('projects').delete().eq('id', projectId)).error);
  }
  if (companyId) fail('client', (await admin.from('companies').delete().eq('id', companyId)).error);
  const gone = users; users = [];
  for (const u of gone) {
    fail('notifications', (await admin.from('notifications').delete().eq('owner_id', u.id)).error);
    await u.remove();
  }
});

test('JOB-BQ15 the billing officer skips an optional step with a reason and reads it beside the step', async ({ page }) => {
  const billing = await createJobRoleUser(admin as SupabaseClient, ORG_ID, 'billing_officer');
  users = [billing];
  await billing.signIn(page);
  await page.goto(`/work-orders/${workOrderId}`);
  await openWorkOrderArea(page, 'billing');
  const step = page.getByTestId('wo-billing-steps').getByRole('listitem', { name: 'Joint check' });
  await expect(step).toBeVisible({ timeout: 15_000 });
  await step.getByRole('button', { name: 'Skip Joint check' }).click();

  const dialog = page.getByRole('dialog', { name: 'Skip Joint check' });
  await expect(dialog.getByRole('button', { name: 'Skip step' })).toBeDisabled();
  await dialog.getByLabel('Reason for skipping').fill('The client waived the joint check');
  await dialog.getByRole('button', { name: 'Skip step' }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });

  await expect(step).toContainText('Skipped');
  await expect(step).toContainText('Reason: The client waived the joint check');
  await page.reload();
  await expect(page.getByTestId('wo-billing-steps').getByRole('listitem', { name: 'Joint check' })).toContainText('Reason: The client waived the joint check', { timeout: 15_000 });
});
