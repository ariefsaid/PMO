// @e2e-isolation: self-isolated — creates its own uniquely named work order on the seed project, closes it, and reopens it as Admin; touches no shared seed work order.
/** AC-WOR-001 — role-job journey (#3024): an Admin opens a Closed work order (no final acceptance) on its detail page, reopens it with a required reason, and sees it return to Issued. */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';
import { SEED_PROJECT_ID, runSuffix, userClient } from './support/stockFixture';

test.setTimeout(120_000);

async function createClosedWorkOrder() {
  const sfx = runSuffix();
  const admin = await userClient('admin@acme.test');
  const orgId = (await admin.from('projects').select('org_id').eq('id', SEED_PROJECT_ID).single()).data?.org_id as string;
  const draft = await admin
    .from('work_orders')
    .insert({
      org_id: orgId,
      project_id: SEED_PROJECT_ID,
      title: `E2E reopen ${sfx}`,
      order_value: 1000,
      tax_treatment: 'exclusive',
      tax_amount: 0,
    })
    .select('id, title')
    .single();
  if (draft.error) throw new Error('work order draft: ' + draft.error.message);

  let issue = await admin.rpc('transition_work_order', { p_id: draft.data.id, p_to: 'Issued' });
  if (issue.error && /acknowledg/i.test(issue.error.message)) {
    issue = await admin.rpc('transition_work_order', { p_id: draft.data.id, p_to: 'Issued', p_over_commit_ack: true });
  }
  if (issue.error) throw new Error('work order issue: ' + issue.error.message);

  const close = await admin.rpc('transition_work_order', { p_id: draft.data.id, p_to: 'Closed' });
  if (close.error) throw new Error('work order close: ' + close.error.message);

  return { id: draft.data.id, title: draft.data.title };
}

test('AC-WOR-001: Admin reopens a Closed work order with a required reason on its page', async ({ page }) => {
  const wo = await createClosedWorkOrder();

  await signIn(page, 'admin@acme.test');
  await page.goto(`/work-orders/${wo.id}`);

  await expect(page.getByText(wo.title)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Closed', { exact: true }).first()).toBeVisible();

  // Open the record header menu and choose Reopen work order.
  await page.getByRole('button', { name: /more actions/i }).click();
  await page.getByRole('menuitem', { name: 'Reopen work order' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/Reason for reopening/i).fill('Closed prematurely before late material entry');
  await dialog.getByRole('button', { name: 'Reopen work order' }).click();

  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect(page.getByText('Issued', { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  // Reload to prove the server persisted Issued.
  await page.reload();
  await expect(page.getByText('Issued', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
});
