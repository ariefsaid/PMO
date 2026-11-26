// @e2e-isolation: self-isolated — owns a project, a work order and one current billing step (unique names), plus a disposable billing-officer job-role login; all deleted in afterEach.
/** JOB-T3 / TC-PA-20 — a billing officer, signed in as the job role itself (not a shared access-level seed login), finds
 *  the current billing step in the "needs you" list at home and it clears once the step is done. */
import { test, expect } from '@playwright/test';
import { serviceClient, need, ownProject, dropProject, uniq, ORG_ID, runId } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';
import { openRowUpdate, openWorkOrderArea } from './support/workOrderArea';

test.setTimeout(120_000);

const admin = serviceClient('JOB-T3');
let projectId = '';
let worker: Awaited<ReturnType<typeof roleJobUser>>;

test.afterEach(async () => {
  if (projectId) {
    await admin.from('work_order_billing_steps').delete().eq('project_id', projectId);
    await admin.from('work_orders').delete().eq('project_id', projectId);
    await dropProject(admin, projectId);
  }
  await worker?.cleanup();
  projectId = '';
});

test('JOB-T3 the current billing step is in the billing officer\'s needs-you list and clears when done', async ({ page }) => {
  const sfx = uniq();
  worker = await roleJobUser(admin, 'billing_officer', runId('t3'));
  projectId = await ownProject(admin, `Billing project ${sfx}`);
  const wo = need('work order', await admin.from('work_orders').insert({
    org_id: ORG_ID, project_id: projectId, title: `Billing work order ${sfx}`, status: 'Issued',
    order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0,
  }).select('id').single());
  // Admin setup gives the issued work order a current step owned by the billing job role.
  await admin.from('work_order_billing_steps').insert({
    org_id: ORG_ID, project_id: projectId, work_order_id: wo.id, position: 1, name: 'Prepare billing evidence',
    owner_role_key: 'billing_officer', started_on: new Date().toISOString().slice(0, 10),
  });

  await worker.signIn(page);
  await page.goto('/');
  const pointer = page.getByRole('link', { name: /work-order billing step waiting for you/i });
  await expect(pointer).toBeVisible();
  await pointer.click();
  await expect(page).toHaveURL(new RegExp(`/work-orders/${wo.id}$`));
  await openWorkOrderArea(page, 'billing');
  await openRowUpdate(page, 'Prepare billing evidence');
  await page.getByRole('button', { name: 'Mark Prepare billing evidence done' }).click();
  await expect(page.getByTestId('wo-billing-steps-summary')).toContainText('Every billing step is finished');
  await page.goto('/');
  await expect(page.getByRole('link', { name: /work-order billing step waiting for you/i })).toHaveCount(0);
});
