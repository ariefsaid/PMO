// @e2e-isolation: serial — sets the org-wide material-request approval chain and a stand-in, which every material-request journey reads.
/** JOB-W3 — a request waits on the project manager step; the person named as the manager's stand-in approves it, the request moves to the next step, and the history shows who they stood in for. */
import { test, expect } from '@playwright/test';
import { signIn } from '../helpers';
import { mrqSetup, submittedRequest, clearStandIns } from '../support/mrqJobFixture';
import { userClient } from '../support/stockFixture';

test.setTimeout(150_000);

test.afterEach(async () => { await clearStandIns(await userClient('admin@acme.test')); });

test('JOB-W3 a named stand-in approves the step and the history shows who they stood in for', async ({ page }) => {
  const { admin, item, wo } = await mrqSetup([
    { role: 'Project Manager', label: 'Plan check' },
    { role: 'Admin', label: 'Stock' },
  ]);
  const requestId = await submittedRequest('engineer@acme.test', wo.id, item.id);
  const pm = (await admin.from('profiles').select('id').eq('email', 'pm@acme.test').single()).data!.id;
  const standIn = (await admin.from('profiles').select('id').eq('email', 'finance@acme.test').single()).data!.id;
  const today = new Date().toISOString().slice(0, 10);
  const until = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const set = await admin.rpc('mrq_set_stand_in', { p_delegator_id: pm, p_stand_in_id: standIn, p_starts_on: today, p_ends_on: until });
  if (set.error) throw new Error(set.error.message);

  await signIn(page, 'finance@acme.test');
  await page.goto(`/material-requests/${requestId}`);
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
  await dialog.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });

  // The request has moved on to the stock step, and the history names the person they stood in for.
  await expect(page.getByTestId('mrq-chain').getByText('Approved')).toHaveCount(1);
  await expect(page.getByText('Waiting for approval').first()).toBeVisible();
  await expect(page.getByText(/for Diego Salvatierra/).first()).toBeVisible();
});
