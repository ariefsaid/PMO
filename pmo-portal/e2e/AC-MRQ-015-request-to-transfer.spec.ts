// @e2e-isolation: self-isolated — creates its own uniquely named item, unit, work order, central warehouse, site location and request each run (stock and request history are append-only, so none is deleted); sets the org's material-request chain (read only by this feature) to PM → Finance → Executive; makes the Finance seed user keeper of its own central warehouse.
/** AC-MRQ-015 — goal: a field controller on a phone raises an over-plan request, three approvers act in order, the last one keeping no warehouse, and the stock keeper then chooses the warehouse and the transfer draft with its delivery document is reachable from the request. */
import { test, expect, type Page } from '@playwright/test';
import { signIn } from './helpers';
import { SEED_PROJECT_ID, SEED_PROJECT_NAME, keeperOf, makeItem, runSuffix, userClient } from './support/stockFixture';

const FINANCE_ID = '00000000-0000-0000-0000-0000000000a3';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
test.setTimeout(180_000);

async function fixture() {
  const sfx = runSuffix();
  const admin = await userClient('admin@acme.test');
  const orgId = (await admin.from('projects').select('org_id').eq('id', SEED_PROJECT_ID).single()).data?.org_id as string;
  const item = await makeItem(admin, sfx, 'M');
  // The app's own path: insert the client-writable columns (a Draft), then issue through transition_work_order,
  // which mints wo_number and stamps issued_at.
  const draft = await admin.from('work_orders').insert({
    org_id: orgId, project_id: SEED_PROJECT_ID, title: `E2E MRQ ${sfx}`, order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0,
  }).select('id').single();
  if (draft.error) throw new Error('work order: ' + draft.error.message);
  let issue = await admin.rpc('transition_work_order', { p_id: draft.data.id, p_to: 'Issued' });
  if (issue.error && /acknowledg/i.test(issue.error.message)) issue = await admin.rpc('transition_work_order', { p_id: draft.data.id, p_to: 'Issued', p_over_commit_ack: true });
  if (issue.error) throw new Error('work order issue: ' + issue.error.message);
  const wo = await admin.from('work_orders').select('id, title, wo_number').eq('id', draft.data.id).single();
  if (wo.error) throw new Error('work order: ' + wo.error.message);
  const chain = await admin.rpc('mrq_set_chain', { p_steps: [
    { role: 'Project Manager', label: 'Plan check', only_over_plan: false },
    { role: 'Finance', label: 'Billable change', only_over_plan: false },
    { role: 'Executive', label: 'Stock', only_over_plan: false },
  ] });
  if (chain.error) throw new Error('chain: ' + chain.error.message);
  const wh = await admin.from('stock_warehouses').insert({ code: `E2E-MC${sfx}`, name: `E2E main ${sfx}`, kind: 'central' }).select('id, code, name').single();
  if (wh.error) throw new Error('warehouse: ' + wh.error.message);
  // The journey's own delivery location. With it the seed project always has several, so the form asks where the
  // material goes and the journey answers — instead of relying on no other test having added a location (they do).
  const site = await admin.from('stock_warehouses').insert({ code: `E2E-MS${sfx}`, name: `E2E site ${sfx}`, kind: 'site', project_id: SEED_PROJECT_ID }).select('id, code, name').single();
  if (site.error) throw new Error('site: ' + site.error.message);
  await keeperOf(admin, wh.data.id, FINANCE_ID);
  return { item, wo: wo.data, warehouse: wh.data, site: site.data };
}

async function pick(page: Page, label: RegExp, option: string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option }).click();
}

async function decide(page: Page, email: string, requestUrl: string) {
  await signIn(page, email);
  await page.goto(requestUrl);
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
  await dialog.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
}

test('AC-MRQ-015: a field controller raises an over-plan request on a phone, three approvers act in order, and the transfer draft is reachable from the request', async ({ page }) => {
  const { item, wo, warehouse, site } = await fixture();

  // Field controller (the Engineer) raises it. The work order has no material plan, so the line is over plan and needs a reason.
  await signIn(page, 'engineer@acme.test');
  await page.goto('/material-requests/new');
  await pick(page, /^project/i, SEED_PROJECT_NAME);
  await pick(page, /^work order/i, `${wo.wo_number} · ${wo.title}`);
  await page.getByLabel('Deliver to').selectOption({ label: `${site.code} · ${site.name}` });
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

  // Three approvers act in order: Project Manager, Finance, then the Executive, who keeps no warehouse and is asked for none.
  await decide(page, 'pm@acme.test', requestUrl);
  await decide(page, 'finance@acme.test', requestUrl);
  await signIn(page, 'exec@acme.test');
  await page.goto(requestUrl);
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  const finalDialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
  await expect(finalDialog.getByLabel(/warehouse the material leaves from/i)).toHaveCount(0);
  await finalDialog.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(finalDialog).toBeHidden({ timeout: 15_000 });

  // The request is approved, shows who acted on each step, and says the stock keeper acts next.
  await page.goto(requestUrl);
  await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('mrq-chain').getByText('Approved')).toHaveCount(3);
  await expect(page.getByText('Approved. The stock keeper chooses the warehouse and sends the stock next.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the delivery document' })).toHaveCount(0);

  // The keeper of the warehouse chooses it; the transfer draft and its delivery document are then reachable from the request.
  await signIn(page, 'finance@acme.test');
  await page.goto(requestUrl);
  await page.getByRole('button', { name: 'Choose warehouse and send', exact: true }).click();
  const sendDialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
  await sendDialog.getByLabel(/warehouse the material leaves from/i).selectOption({ label: `${warehouse.code} · ${warehouse.name}` });
  await sendDialog.getByRole('button', { name: 'Choose warehouse and send', exact: true }).click();
  await expect(sendDialog).toBeHidden({ timeout: 15_000 });
  await page.getByRole('link', { name: 'Open the delivery document' }).click();
  await expect(page).toHaveURL(/\/stock\/documents\/[0-9a-f-]{36}/, { timeout: 15_000 });
  await expect(page.getByText(item.code).first()).toBeVisible();
});
