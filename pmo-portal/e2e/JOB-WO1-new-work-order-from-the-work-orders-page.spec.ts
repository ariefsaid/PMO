// @e2e-isolation: self-isolated — owns its job-role login, project and work orders; changes no organisation-wide setting; removes owned rows in finally.
// JOB-WO1 (#1126): the person who captures a client's work order does it from the Work orders page, not from inside a
// project's contract: New work order → choose the project → Create draft → they land on the new draft. From a project's
// own Work orders tab the project is already set and cannot be changed.
import { test, expect } from '@playwright/test';
import { cleanupAll, need, ORG_ID, runId, serviceClient } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(180_000);

test('JOB-WO1 the issuer creates a work order from the Work orders page by choosing its project, and lands on the draft; from a project tab the project is locked', async ({ page }) => {
  const svc = serviceClient('JOB-WO1');
  const run = runId('JOBWO1');
  const pcm = await roleJobUser(svc, 'project_control_manager', `${run}-pcm`);
  const projectIds: string[] = [];
  try {
    for (const name of [`${run} harbour`, `${run} depot`]) {
      projectIds.push(need('project', await svc.from('projects').insert({
        org_id: ORG_ID, name, status: 'Ongoing Project', currency: 'USD',
        contract_value: 900_000_000_000, tax_treatment: 'exclusive', tax_amount: 0,
      }).select('id').single()).id as string);
    }

    await pcm.signIn(page);
    await page.goto('/work-orders');
    await page.getByRole('button', { name: 'New work order' }).click();
    const form = page.getByRole('dialog');

    // No project chosen yet: the draft cannot be created.
    await form.getByLabel(/^Title/).fill(`${run} site works`);
    await form.getByTestId('wo-order-value').fill('150000000');
    await form.getByTestId('wo-tax-treatment').selectOption('exclusive');
    await form.getByTestId('wo-tax-amount').fill('0');
    await expect(form.getByRole('button', { name: 'Create draft' })).toBeDisabled();

    await form.getByRole('combobox', { name: /Project/ }).click();
    await page.getByPlaceholder('Search projects…').fill(`${run} depot`);
    await page.getByRole('listbox').getByRole('option', { name: new RegExp(`${run} depot`) }).click();
    await form.getByRole('button', { name: 'Create draft' }).click();

    await expect(page).toHaveURL(/\/work-orders\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    const id = page.url().split('/').pop() as string;
    const { data: created } = await svc.from('work_orders').select('status, project_id, title').eq('id', id).single();
    expect(created).toMatchObject({ status: 'Draft', project_id: projectIds[1], title: `${run} site works` });
    await expect(page.getByRole('main').getByText(`${run} site works`, { exact: true }).first()).toBeVisible();

    // From the project's own Work orders tab the project is preset and locked.
    await page.goto(`/projects/${projectIds[0]}/orders`);
    await page.getByRole('button', { name: 'New work order' }).click();
    const tabForm = page.getByRole('dialog');
    await expect(tabForm.getByRole('combobox', { name: /Project/ })).toBeDisabled();
    await expect(tabForm.getByRole('combobox', { name: /Project/ })).toContainText(`${run} harbour`);
  } finally {
    const { data: orders } = await svc.from('work_orders').select('id').in('project_id', projectIds);
    await cleanupAll(svc, [
      ['work_orders', 'id', (orders ?? []).map((o) => o.id)],
      ['projects', 'id', projectIds],
    ]);
    await pcm.cleanup();
  }
});
