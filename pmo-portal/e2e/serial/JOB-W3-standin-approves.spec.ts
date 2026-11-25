// @e2e-isolation: serial — sets the org-wide material-request approval chain (an engineer step, then construction) and a stand-in, which every material-request journey reads; both are cleared after each run.
/** JOB-W3 — three approvers and a stand-in: a request waits on its engineer step, the person the engineer named as stand-in approves it, the
 *  request moves on to construction, and the history shows the stand-in approved for the engineer. */
import { test, expect } from '@playwright/test';
import { runId, serviceClient } from '../support/jobFixtures';
import { clearStandIns, mrqSetup, submittedRequest } from '../support/mrqJobFixture';
import { roleJobUser } from '../support/roleJobUser';
import { userClient } from '../support/stockFixture';

test.setTimeout(180_000);

test.afterEach(async () => { await clearStandIns(await userClient('admin@acme.test')); });

test('JOB-W3 a named stand-in approves the engineer step and the history shows who they stood in for', async ({ page }) => {
  const svc = serviceClient('JOB-W3');
  const engineerName = runId('w3-eng');
  const engineer = await roleJobUser(svc, 'engineer', engineerName);
  const standIn = await roleJobUser(svc, 'engineer', runId('w3-standin'));
  // Two job-role steps: an engineer decides the material change, then construction takes the request on.
  const steps = [
    { role: 'Engineer', label: 'Engineer check', job_role: 'engineer' },
    { role: 'Project Manager', label: 'Construction check', job_role: 'construction_manager' },
  ] as unknown as Array<{ role: string; label: string }>;
  const { admin, item, wo } = await mrqSetup(steps);
  try {
    // The requester raises it; the engineer named as stand-in decides the engineer step.
    const requestId = await submittedRequest('engineer@acme.test', wo.id, item.id);
    const today = new Date().toISOString().slice(0, 10);
    const until = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const set = await admin.rpc('mrq_set_stand_in', { p_delegator_id: engineer.id, p_stand_in_id: standIn.id, p_starts_on: today, p_ends_on: until });
    if (set.error) throw new Error(set.error.message);

    // 1. The stand-in signs in and finds the request in Material requests → Waiting for me.
    await standIn.signIn(page);
    await page.goto('/material-requests');
    await page.getByRole('tab', { name: /Waiting for me/ }).click();
    const row = page.getByRole('row').filter({ hasText: 'Engineer check' });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).toContainText('standing in');
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/material-requests/${requestId}$`), { timeout: 20_000 });

    // 2. It approves the engineer step.
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
    await dialog.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    // 3. Goal: the request is on the construction step and the history names the engineer it stood in for.
    await expect(page.getByTestId('mrq-chain').getByText('Engineer check')).toBeVisible();
    await expect(page.getByTestId('mrq-chain').getByText('Construction check')).toBeVisible();
    await expect(page.getByText('Waiting for approval').first()).toBeVisible();
    await expect(page.getByText(new RegExp(`for ${engineerName}`)).first()).toBeVisible();
  } finally {
    await engineer.cleanup();
    await standIn.cleanup();
  }
});
