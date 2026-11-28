// @e2e-isolation: self-isolated — owns its five job-role logins, project, work orders, documents and tasks; changes no organisation-wide setting; removes owned rows in finally.
// JOB-PC12 (project control, #2898): a client's work order is captured once as a Draft by the person who issues it; each
// check before it is issued is a task with an owner, found in that owner's My tasks and closed there with a note and
// proof; the project manager issues it. A second Draft is cancelled with a reason and stays readable.
import { expect, type Page } from '@playwright/test';
import { signInJourneyActor } from './support/seedSession';
import { test } from './support/workOrderChecksFixture';
import { openWorkOrderArea } from './support/workOrderArea';

test.setTimeout(240_000);

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

async function pick(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByPlaceholder('Search options…').fill(option);
  await page
    .getByRole('listbox')
    .getByRole('option', { name: new RegExp(option) })
    .click();
}

test('JOB-PC12 the issuer captures a Draft and attaches the client document', async ({
  page,
  checksFixture,
}) => {
  const { run, pcm, projectId } = checksFixture;
  // 1. The issuer captures the client's work order as a Draft, with the client's reference.
  await signInJourneyActor(page, pcm.email, pcm.password);
  await page.goto(`/projects/${projectId}/orders`);
  await page.getByRole('button', { name: 'New work order' }).first().click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Client reference').fill(`${run}/WO/001`);
  await form.getByLabel(/^Title/).fill(`${run} site works`);
  await form.getByTestId('wo-order-value').fill('150000000');
  await form.getByTestId('wo-tax-treatment').selectOption('exclusive');
  await form.getByTestId('wo-tax-amount').fill('0');
  await form.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/work-orders\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  await expect(page.getByText(`Client PO ${run}/WO/001`)).toBeVisible({ timeout: 20_000 });

  // ...and attaches the client's document to it.
  await openWorkOrderArea(page, 'documents');
  await page.getByRole('button', { name: 'Add document' }).click();
  await page.getByRole('dialog').getByLabel(/Title/).fill(`${run} client work order`);
  await page.getByRole('dialog').getByRole('button', { name: 'Add document' }).click();
  await expect(page.getByText(`${run} client work order`)).toBeVisible({ timeout: 15_000 });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Upload/i }).click();
  await (
    await chooser
  ).setFiles({ name: 'client-work-order.pdf', mimeType: 'application/pdf', buffer: PDF });
  await expect(
    page.getByRole('button', { name: `Replace file for ${run} client work order` }),
  ).toBeVisible({ timeout: 20_000 });
});

test('JOB-PC12 the issuer assigns three checks with owners and due dates', async ({
  page,
  checksFixture,
}) => {
  const { pcm, owners } = checksFixture;
  const workOrderId = await checksFixture.draft();
  await signInJourneyActor(page, pcm.email, pcm.password);
  await page.goto(`/work-orders/${workOrderId}`);
  // 2. The issuer adds three checks, each with an owner from a different job and a due date.
  const checks = page.getByTestId('wo-checks');
  for (const o of owners) {
    await checks.getByLabel('Check', { exact: true }).fill(o.check);
    await pick(page, 'Owner', o.name);
    await checks.getByLabel('Due').fill('10 Dec 2026');
    await checks.getByRole('button', { name: 'Add check' }).click();
    await expect(checks.getByRole('listitem').filter({ hasText: o.check })).toContainText(o.name, {
      timeout: 15_000,
    });
  }
  await expect(page.getByTestId('wo-checks-open')).toHaveText('3 of 3 open');
});

for (const ownerIndex of [0, 1, 2]) {
  test(`JOB-PC12 the check owner completes their check from My tasks with a note and proof (${ownerIndex})`, async ({
    page,
    checksFixture,
  }) => {
    const { svc, run, owners } = checksFixture;
    const workOrderId = await checksFixture.draft();
    await checksFixture.checks(workOrderId);
    const o = owners[ownerIndex];
    await signInJourneyActor(page, o.user.email, o.user.password);
    await page.goto('/my-tasks');
    const main = page.getByRole('main');
    await expect(main.getByRole('link', { name: o.check })).toBeVisible({ timeout: 20_000 });
    await expect(main.getByRole('link', { name: `${run} site works` })).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Notifications, [1-9]\d* unread/ }),
    ).toBeVisible();
    await main.getByRole('button', { name: `Comments ${o.check}` }).click();
    const drawer = page.getByRole('dialog');
    await drawer.getByLabel('Add a comment').fill('Checked against the client document; no gaps.');
    await drawer.getByRole('button', { name: 'Post comment' }).click();
    await expect(drawer.getByText('Checked against the client document; no gaps.')).toBeVisible({
      timeout: 15_000,
    });
    await drawer
      .getByTestId('proof-document-input')
      .setInputFiles({ name: 'check-proof.pdf', mimeType: 'application/pdf', buffer: PDF });
    await expect(drawer.getByText('check-proof.pdf')).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press('Escape');
    await page.getByLabel(`Change status of ${o.check}`).selectOption('Done');
    await expect
      .poll(
        async () =>
          (
            await svc
              .from('tasks')
              .select('status')
              .eq('work_order_id', workOrderId)
              .eq('name', o.check)
              .single()
          ).data?.status,
        { timeout: 15_000 },
      )
      .toBe('Done');
  });
}

test('JOB-PC12 the project manager issues a work order whose three checks are done', async ({
  page,
  checksFixture,
}) => {
  const { svc, pm, owners } = checksFixture;
  const workOrderId = await checksFixture.draft();
  await checksFixture.checks(workOrderId, 'Done');
  // 4. The project manager sees all three done and issues the work order.
  await signInJourneyActor(page, pm.email, pm.password);
  await page.goto(`/work-orders/${workOrderId}`);
  for (const o of owners)
    await expect(
      page.getByTestId('wo-checks').getByRole('listitem').filter({ hasText: o.check }),
    ).toContainText('Done', { timeout: 20_000 });
  await expect(page.getByTestId('wo-checks')).toContainText('All 3 done');
  await expect(page.getByTestId('wo-checks-open')).toHaveCount(0);
  await page.getByRole('button', { name: 'Issue', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Issue work order' }).click();
  await expect(page.getByTestId('wo-checks')).toHaveCount(0, { timeout: 20_000 });
  await expect
    .poll(
      async () =>
        (await svc.from('work_orders').select('status').eq('id', workOrderId).single()).data
          ?.status,
      { timeout: 15_000 },
    )
    .toBe('Issued');
});

test('JOB-PC12 the issuer cancels a second Draft with a readable reason', async ({
  page,
  checksFixture,
}) => {
  const { run, pcm, projectId } = checksFixture;
  // 5. A second captured Draft is cancelled with a reason, and stays readable with it.
  await signInJourneyActor(page, pcm.email, pcm.password);
  await page.goto(`/projects/${projectId}/orders`);
  await page.getByRole('button', { name: 'New work order' }).first().click();
  await page
    .getByRole('dialog')
    .getByLabel(/^Title/)
    .fill(`${run} withdrawn scope`);
  await page.getByRole('dialog').getByTestId('wo-order-value').fill('1000000');
  await page.getByRole('dialog').getByTestId('wo-tax-treatment').selectOption('exclusive');
  await page.getByRole('dialog').getByTestId('wo-tax-amount').fill('0');
  await page.getByRole('dialog').getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/work-orders\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Cancel work order' }).click();
  const reason = page.getByRole('alertdialog');
  await reason
    .getByLabel(/Reason for cancelling/)
    .fill('The client withdrew this scope before award');
  await reason.getByRole('button', { name: 'Cancel work order' }).click();
  await page.reload();
  await expect(page.getByTestId('wo-cancel-reason')).toHaveText(
    'Cancelled because: The client withdrew this scope before award',
    { timeout: 20_000 },
  );
  await expect(
    page.getByRole('main').getByText(`${run} withdrawn scope`, { exact: true }),
  ).toBeVisible();
});
