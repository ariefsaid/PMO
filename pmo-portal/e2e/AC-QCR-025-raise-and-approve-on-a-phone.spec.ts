// @e2e-isolation: self-isolated — creates its own uniquely-named project, work order and over-contract line each run and removes them (requests, versions, files) afterwards; touches no shared seed row.
/**
 * AC-QCR-025 — quantity change request (#2578): the one cross-stack journey for raising and approving. On a 390px phone the
 * Project Manager sees the over-contract flag on a contract line, raises a request for it and submits it; they are never
 * offered Approve. A different person (Finance) then approves it: the request is approved and shows both people.
 * Goal oracle: the request is `approved`, approved by Finance, raised by the PM — and the PM could not approve it.
 */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';
import { cleanFixture, makeFixture, type QcrFixture } from './qcrFixture';

test.setTimeout(120_000);
test.use({ viewport: { width: 390, height: 844 } });

let fx: QcrFixture | undefined;
test.beforeEach(async () => { fx = await makeFixture('AC-QCR-025'); });
test.afterEach(async () => { await cleanFixture(fx); fx = undefined; });

test('AC-QCR-025 a PM sees the over-contract flag, raises a request, and a different Finance user approves it', async ({ page }) => {
  const f = fx!;
  const names = await f.admin.from('profiles').select('id, full_name').in('id', [f.pmId, f.financeId]);
  const pmName = names.data!.find((p) => p.id === f.pmId)!.full_name as string;
  const financeName = names.data!.find((p) => p.id === f.financeId)!.full_name as string;

  await signIn(page, 'pm@acme.test');
  await page.goto(`/quantity-changes?project=${f.projectId}`);
  const row = page.getByTestId('qcr-over-row');
  await expect(row).toContainText('Over contract', { timeout: 15_000 });
  await expect(row).toContainText('EXC');
  await expect(row).toContainText('Assessment');

  await page.getByRole('button', { name: 'New request' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Work order').selectOption({ label: `${f.tag} work order` });
  await dialog.getByLabel(/Requested total quantity/).fill('130');
  await dialog.getByLabel('Reason').fill('Rock found below the design level');
  await dialog.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/quantity-changes\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  const requestUrl = page.url();
  await expect(page.getByTestId('qcr-status')).toHaveAttribute('data-status', 'draft');

  await page.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(page.getByTestId('qcr-status')).toHaveAttribute('data-status', 'pending_approval', { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(page.getByTestId('qcr-approval-block')).toContainText('cannot approve quantity change requests');

  await signIn(page, 'finance@acme.test');
  await page.goto(requestUrl);
  await expect(page.getByTestId('qcr-status')).toHaveAttribute('data-status', 'pending_approval', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByTestId('qcr-status')).toHaveAttribute('data-status', 'approved', { timeout: 15_000 });
  await expect(page.getByTestId('qcr-approved-by')).toContainText(financeName);
  await expect(page.getByText(`Raised by ${pmName}`)).toBeVisible();
});
