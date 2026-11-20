// @e2e-isolation: self-isolated — creates its own uniquely named item, unit, work order and request each run (stock and request history are append-only, so none is deleted); sets the org's material-request chain (read only by this feature) to PM → Finance → Admin.
/** AC-MRQ-015 — goal: a field controller on a phone raises an over-plan request, three approvers act in order, and the transfer draft with its delivery document is reachable from the request. */
import { test, expect, type Page } from '@playwright/test';
import { signIn } from './helpers';
import { SEED_PROJECT_ID, SEED_PROJECT_NAME, makeItem, runSuffix, userClient } from './support/stockFixture';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
test.setTimeout(180_000);

async function fixture() {
  const sfx = runSuffix();
  const admin = await userClient('admin@acme.test');
  const orgId = (await admin.from('projects').select('org_id').eq('id', SEED_PROJECT_ID).single()).data?.org_id as string;
  const item = await makeItem(admin, sfx, 'M');
  const wo = await admin.from('work_orders').insert({
    org_id: orgId, project_id: SEED_PROJECT_ID, title: `E2E MRQ ${sfx}`, wo_number: `E2E-MRQ-${sfx}`, status: 'Issued',
    issued_at: new Date().toISOString(), order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0,
  }).select('id, title, wo_number').single();
  if (wo.error) throw new Error('work order: ' + wo.error.message);
  const chain = await admin.rpc('mrq_set_chain', { p_steps: [
    { role: 'Project Manager', label: 'Plan check', only_over_plan: false },
    { role: 'Finance', label: 'Billable change', only_over_plan: false },
    { role: 'Admin', label: 'Stock', only_over_plan: false },
  ] });
  if (chain.error) throw new Error('chain: ' + chain.error.message);
  const wh = await admin.from('stock_warehouses').insert({ code: `E2E-MC${sfx}`, name: `E2E main ${sfx}`, kind: 'central' }).select('id, code, name').single();
  if (wh.error) throw new Error('warehouse: ' + wh.error.message);
  return { item, wo: wo.data, warehouse: wh.data };
}

async function pick(page: Page, label: RegExp, option: string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option }).click();
}

async function decide(page: Page, email: string, requestUrl: string, source?: string) {
  await signIn(page, email);
  await page.goto(requestUrl);
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
  if (source) await dialog.getByLabel(/warehouse the material leaves from/i).selectOption({ label: source });
  await dialog.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
}

test('AC-MRQ-015: a field controller raises an over-plan request on a phone, three approvers act in order, and the transfer draft is reachable from the request', async ({ page }) => {
  const { item, wo, warehouse } = await fixture();

  // Field controller (the Engineer) raises it. The work order has no material plan, so the line is over plan and needs a reason.
  await signIn(page, 'engineer@acme.test');
  await page.goto('/material-requests/new');
  await pick(page, /^project/i, SEED_PROJECT_NAME);
  await pick(page, /^work order/i, `${wo.wo_number} · ${wo.title}`);
  await page.getByLabel(/^item/i).selectOption({ label: `${item.code} · ${item.name}` });
  await page.getByLabel(/^quantity/i).fill('7');
  await expect(page.getByTestId('mrq-plan')).toContainText('Over plan');
  await page.getByRole('button', { name: 'Send for approval' }).click();
  await expect(page.getByText(/give a reason/i)).toBeVisible();
  await page.getByLabel(/why do you need more than the plan/i).fill('Extra pour on the east slab');
  await page.getByRole('button', { name: 'Send for approval' }).click();
  await expect(page).toHaveURL(/\/material-requests\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  const requestUrl = new URL(page.url()).pathname;
  await expect(page.getByText('Waiting for approval').first()).toBeVisible();

  // The author cannot approve their own request.
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);

  // Step 2's approver sees nothing to do until step 1 is approved.
  await signIn(page, 'finance@acme.test');
  await page.goto(requestUrl);
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);

  // Three approvers act in order: Project Manager, Finance, then Admin, who names the source warehouse.
  await decide(page, 'pm@acme.test', requestUrl);
  await decide(page, 'finance@acme.test', requestUrl);
  await decide(page, 'admin@acme.test', requestUrl, `${warehouse.code} · ${warehouse.name}`);

  // The request is approved, shows who acted on each step, and links to the transfer draft's delivery document.
  await page.goto(requestUrl);
  await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('mrq-chain').getByText('Approved')).toHaveCount(3);
  await page.getByRole('link', { name: 'Open the delivery document' }).click();
  await expect(page).toHaveURL(/\/stock\/documents\/[0-9a-f-]{36}/, { timeout: 15_000 });
  await expect(page.getByText(item.code).first()).toBeVisible();
});
