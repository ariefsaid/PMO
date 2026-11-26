// @e2e-isolation: self-isolated — owns its five job-role logins, project, work orders, documents and tasks; changes no organisation-wide setting; removes owned rows in finally.
// JOB-PC12 (project control, #2898): a client's work order is captured once as a Draft by the person who issues it; each
// check before it is issued is a task with an owner, found in that owner's My tasks and closed there with a note and
// proof; the project manager issues it. A second Draft is cancelled with a reason and stays readable.
import { test, expect, type Page } from '@playwright/test';
import { cleanupAll, need, ok, ORG_ID, runId, serviceClient } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';
import { openWorkOrderArea } from './support/workOrderArea';

test.setTimeout(240_000);

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

async function pick(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByPlaceholder('Search options…').fill(option);
  await page.getByRole('listbox').getByRole('option', { name: new RegExp(option) }).click();
}

test('JOB-PC12 the issuer captures a work order as Draft with its document; three owners close their checks from My tasks; the project manager issues it; a second Draft is cancelled with a reason', async ({ page }) => {
  const svc = serviceClient('JOB-PC12');
  const run = runId('JOBPC12');
  const pcm = await roleJobUser(svc, 'project_control_manager', `${run}-pcm`);
  const pm = await roleJobUser(svc, 'project_manager', `${run}-pm`);
  const owners = [
    { user: await roleJobUser(svc, 'engineer', `${run}-eng`), name: `${run}-eng`, check: `${run} drawings and scope checked` },
    { user: await roleJobUser(svc, 'material_coordinator', `${run}-mat`), name: `${run}-mat`, check: `${run} material availability checked` },
    { user: await roleJobUser(svc, 'hr_officer', `${run}-hr`), name: `${run}-hr`, check: `${run} crew availability checked` },
  ];
  let projectId = '';

  try {
    // The issuer is the project manager's line manager, so the value the issuer captures is one the project manager may issue.
    ok('line manager', await svc.from('profiles').update({ manager_id: pcm.id }).eq('id', pm.id));
    projectId = need('project', await svc.from('projects').insert({
      org_id: ORG_ID, name: `${run} project`, status: 'Ongoing Project', currency: 'USD',
      contract_value: 900_000_000_000, tax_treatment: 'exclusive', tax_amount: 0, project_manager_id: pm.id,
    }).select('id').single()).id as string;

    // 1. The issuer captures the client's work order as a Draft, with the client's reference.
    await pcm.signIn(page);
    await page.goto(`/projects/${projectId}/orders`);
    await page.getByRole('button', { name: 'New work order' }).click();
    const form = page.getByRole('dialog');
    await form.getByLabel('Client reference').fill(`${run}/WO/001`);
    await form.getByLabel(/^Title/).fill(`${run} site works`);
    await form.getByTestId('wo-order-value').fill('150000000');
    await form.getByTestId('wo-tax-treatment').selectOption('exclusive');
    await form.getByTestId('wo-tax-amount').fill('0');
    await form.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/work-orders\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    const workOrderId = page.url().split('/').pop() as string;
    await expect(page.getByText(`Client PO ${run}/WO/001`)).toBeVisible({ timeout: 20_000 });

    // ...and attaches the client's document to it.
    await openWorkOrderArea(page, 'documents');
    await page.getByRole('button', { name: 'Add document' }).click();
    await page.getByRole('dialog').getByLabel(/Title/).fill(`${run} client work order`);
    await page.getByRole('dialog').getByRole('button', { name: 'Add document' }).click();
    await expect(page.getByText(`${run} client work order`)).toBeVisible({ timeout: 15_000 });
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Upload/i }).click();
    await (await chooser).setFiles({ name: 'client-work-order.pdf', mimeType: 'application/pdf', buffer: PDF });
    await expect(page.getByRole('button', { name: `Replace file for ${run} client work order` })).toBeVisible({ timeout: 20_000 });

    // 2. The issuer adds three checks, each with an owner from a different job and a due date.
    const checks = page.getByTestId('wo-checks');
    for (const o of owners) {
      await checks.getByLabel('Check', { exact: true }).fill(o.check);
      await pick(page, 'Owner', o.name);
      await checks.getByLabel('Due').fill('10 Dec 2026');
      await checks.getByRole('button', { name: 'Add check' }).click();
      await expect(checks.getByRole('listitem').filter({ hasText: o.check })).toContainText(o.name, { timeout: 15_000 });
    }
    await expect(page.getByTestId('wo-checks-open')).toHaveText('3 of 3 open');

    // 3. Each owner finds the check in My tasks, with the work order named, and closes it with a note and proof.
    for (const o of owners) {
      await o.user.signIn(page);
      await page.goto('/my-tasks');
      const main = page.getByRole('main');
      await expect(main.getByRole('link', { name: o.check })).toBeVisible({ timeout: 20_000 });
      await expect(main.getByRole('link', { name: `${run} site works` })).toBeVisible();
      await expect(page.getByRole('button', { name: /Notifications, [1-9]\d* unread/ })).toBeVisible();
      await main.getByRole('button', { name: `Comments ${o.check}` }).click();
      const drawer = page.getByRole('dialog');
      await drawer.getByLabel('Add a comment').fill('Checked against the client document; no gaps.');
      await drawer.getByRole('button', { name: 'Post comment' }).click();
      await expect(drawer.getByText('Checked against the client document; no gaps.')).toBeVisible({ timeout: 15_000 });
      await drawer.getByTestId('proof-document-input').setInputFiles({ name: 'check-proof.pdf', mimeType: 'application/pdf', buffer: PDF });
      await expect(drawer.getByText('check-proof.pdf')).toBeVisible({ timeout: 20_000 });
      await page.keyboard.press('Escape');
      await page.getByLabel(`Change status of ${o.check}`).selectOption('Done');
      await expect.poll(async () => (await svc.from('tasks').select('status').eq('work_order_id', workOrderId).eq('name', o.check).single()).data?.status, { timeout: 15_000 }).toBe('Done');
    }

    // 4. The project manager sees all three done and issues the work order.
    await pm.signIn(page);
    await page.goto(`/work-orders/${workOrderId}`);
    for (const o of owners) await expect(page.getByTestId('wo-checks').getByRole('listitem').filter({ hasText: o.check })).toContainText('Done', { timeout: 20_000 });
    await expect(page.getByTestId('wo-checks')).toContainText('All 3 done');
    await expect(page.getByTestId('wo-checks-open')).toHaveCount(0);
    await page.getByRole('button', { name: 'Issue', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Issue work order' }).click();
    await expect(page.getByTestId('wo-checks')).toHaveCount(0, { timeout: 20_000 });
    await expect.poll(async () => (await svc.from('work_orders').select('status').eq('id', workOrderId).single()).data?.status, { timeout: 15_000 }).toBe('Issued');

    // 5. A second captured Draft is cancelled with a reason, and stays readable with it.
    await pcm.signIn(page);
    await page.goto(`/projects/${projectId}/orders`);
    await page.getByRole('button', { name: 'New work order' }).click();
    await form.getByLabel(/^Title/).fill(`${run} withdrawn scope`);
    await form.getByTestId('wo-order-value').fill('1000000');
    await form.getByTestId('wo-tax-treatment').selectOption('exclusive');
    await form.getByTestId('wo-tax-amount').fill('0');
    await form.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/work-orders\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Cancel work order' }).click();
    const reason = page.getByRole('alertdialog');
    await reason.getByLabel(/Reason for cancelling/).fill('The client withdrew this scope before award');
    await reason.getByRole('button', { name: 'Cancel work order' }).click();
    await page.reload();
    await expect(page.getByTestId('wo-cancel-reason')).toHaveText('Cancelled because: The client withdrew this scope before award', { timeout: 20_000 });
    await expect(page.getByRole('main').getByText(`${run} withdrawn scope`, { exact: true })).toBeVisible();
  } finally {
    const { data: orders } = projectId ? await svc.from('work_orders').select('id').eq('project_id', projectId) : { data: [] as { id: string }[] };
    const orderIds = (orders ?? []).map((o) => o.id);
    const { data: docs } = projectId ? await svc.from('project_documents').select('id').eq('project_id', projectId) : { data: [] as { id: string }[] };
    await cleanupAll(svc, [
      ['tasks', 'project_id', projectId ? [projectId] : []],
      ['project_documents', 'id', (docs ?? []).map((d) => d.id)],
      ['work_orders', 'id', orderIds],
      ['projects', 'id', projectId ? [projectId] : []],
    ]);
    for (const o of owners) await o.user.cleanup();
    await pm.cleanup();
    await pcm.cleanup();
  }
});
