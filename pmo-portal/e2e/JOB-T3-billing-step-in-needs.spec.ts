// @e2e-isolation: self-isolated — disposable tenant and billing-officer login, own work order and current step.
import { test, expect } from '@playwright/test';
import { serviceClient, need } from './support/jobJourney';
import { createJobRoleUser, removeJobOrganization } from './support/jobRoleUser';

test.setTimeout(120000);
test('JOB-T3 billing officer finds the current billing step at home and it clears after completion', async ({ page }) => {
  const db = serviceClient('JOB-T3');
  const must = need('JOB-T3');
  const org = must('organisation', await db.from('organizations').insert({ name: `Billing ${crypto.randomUUID()}`, built_in_roles_enabled: true }).select('id').single());
  const billing = await createJobRoleUser(db, org.id, 'billing_officer');
  try {
    const project = must('project', await db.from('projects').insert({ org_id: org.id, name: 'Billing work', status: 'Ongoing Project' }).select('id').single());
    const wo = must('work order', await db.from('work_orders').insert({ org_id: org.id, project_id: project.id, title: 'Billing work order', status: 'Issued', order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0 }).select('id').single());
    // Admin setup gives the issued work order a current step owned by the billing job role.
    must('current step', await db.from('work_order_billing_steps').insert({ org_id: org.id, project_id: project.id, work_order_id: wo.id, position: 1, name: 'Prepare billing evidence', owner_role_key: 'billing_officer', started_on: new Date().toISOString().slice(0, 10) }).select('id'));
    await billing.signIn(page);
    await page.goto('/');
    const pointer = page.getByRole('link', { name: /work-order billing step waiting for you/i });
    await expect(pointer).toBeVisible();
    await pointer.click();
    await expect(page).toHaveURL(new RegExp(`/work-orders/${wo.id}$`));
    await page.getByRole('button', { name: 'Mark Prepare billing evidence done' }).click();
    await expect(page.getByTestId('wo-billing-steps-summary')).toContainText('Every billing step is finished');
    await page.goto('/');
    await expect(page.getByRole('link', { name: /work-order billing step waiting for you/i })).toHaveCount(0);
  } finally {
    removeJobOrganization(org.id);
    await billing.remove();
  }
});
