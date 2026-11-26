// @e2e-isolation: serial — turns on the org-wide reservation setting and sets the org-wide material-request approval chain.
/** AC-RSV-018 — goal: a keeper holds stock for one work order and sees "x free + y reserved"; another work order's request that takes
 *  the reserved stock goes through a borrowing approval, and afterwards the stock reads the new free and reserved figures. */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { tableCell } from '../support/tableCell';
import { signIn } from '../helpers';
import { mrqSetup } from '../support/mrqJobFixture';
import { serviceClient } from '../support/jobFixtures';
import { SEED_PROJECT_ID, SEED_PROJECT_NAME, keeperOf, makeWarehouse, postReceive, runSuffix, userClient } from '../support/stockFixture';

test.setTimeout(180_000);

test('AC-RSV-018 reserve for one work order, then a request borrowing it is approved by the borrowing approver and the figures update', async ({ page }) => {
  const { admin, item, wo } = await mrqSetup([{ role: 'Project Manager', label: 'Stock check' }]);
  const sfx = runSuffix();
  const source = await makeWarehouse(admin, sfx, 'RS', 'central');
  await postReceive(admin, source.id, item.id, '10');
  await keeperOf(admin, source.id);
  // The requester names where the material goes: the project has several delivery locations, so the request must say which.
  const dest = await admin.from('stock_warehouses').insert({ code: `E2E-RD${sfx}`, name: `E2E delivery ${sfx}`, kind: 'site', project_id: SEED_PROJECT_ID }).select('id').single();
  if (dest.error) throw new Error('destination: ' + dest.error.message);
  const exec = await admin.from('profiles').select('id').eq('email', 'exec@acme.test').single();
  if (exec.error) throw new Error('exec: ' + exec.error.message);
  await keeperOf(admin, source.id, exec.data.id as string);
  const orgId = (await admin.from('projects').select('org_id').eq('id', SEED_PROJECT_ID).single()).data?.org_id as string;
  const other = await serviceClient('reservation journey').from('work_orders').insert({
    org_id: orgId, project_id: SEED_PROJECT_ID, title: `RSV B ${sfx}`, wo_number: `RSV-B-${sfx}`, status: 'Issued',
    issued_at: new Date().toISOString(), order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0,
  }).select('id').single();
  if (other.error) throw new Error('work order: ' + other.error.message);
  const on = await admin.rpc('set_stock_reservations', { p_on: true, p_borrow_mode: 'approve', p_borrow_role: 'Executive', p_borrow_label: 'Borrowing' });
  if (on.error) throw new Error('setting: ' + on.error.message);

  // The keeper reserves 8 of 10 for the first work order, on a phone-sized screen too.
  await signIn(page, 'engineer@acme.test');
  await page.goto('/stock');
  await page.getByRole('searchbox').fill(item.code);
  await page.getByRole('button', { name: 'Reserve', exact: true }).first().click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Project').selectOption({ label: SEED_PROJECT_NAME });
  await form.getByLabel('Work order').selectOption({ label: `${wo.wo_number} - ${wo.title}` });
  await form.getByLabel('Quantity').fill('8');
  await form.getByRole('button', { name: 'Reserve', exact: true }).click();
  await expect(form).toBeHidden({ timeout: 15_000 });
  // The row reads 2 free and 8 reserved.
  await expect(await tableCell(page, item.code, 'Free')).toHaveText(/^2\b/);
  await expect(await tableCell(page, item.code, 'Reserved')).toHaveText(/^8\b/);
  await page.getByRole('button', { name: 'Show work order' }).first().click();
  await expect(page.getByRole('link', { name: new RegExp(wo.wo_number) }).first()).toBeVisible();

  // The second work order asks for 5: 2 are free, 3 are borrowed.
  const engineer = await userClient('engineer@acme.test');
  const saved = await engineer.rpc('mrq_save_draft', {
    p_request_id: null, p_header: { work_order_id: other.data.id, needed_by: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10), to_warehouse_id: dest.data.id, note: null },
    p_lines: [{ item_id: item.id, quantity: '5', over_plan_reason: 'RSV journey' }], p_client_request_id: randomUUID(),
  });
  if (saved.error) throw new Error('draft: ' + saved.error.message);
  const sub = await engineer.rpc('mrq_submit', { p_request_id: saved.data, p_client_request_id: randomUUID() });
  if (sub.error) throw new Error('submit: ' + sub.error.message);

  await signIn(page, 'pm@acme.test');
  await page.goto(`/material-requests/${saved.data}`);
  await expect(page.getByRole('status').filter({ hasText: 'Borrowing.' })).toBeVisible();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: 'Approve', exact: true }).click();

  await signIn(page, 'exec@acme.test');
  await page.goto(`/material-requests/${saved.data}`);
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
  await dialog.getByLabel(/warehouse the material leaves from/i).selectOption({ label: `${source.code} · ${source.name}` });
  await dialog.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });

  // The lender gave up 3: 10 on hand, 5 reserved, 5 free.
  await signIn(page, 'engineer@acme.test');
  await page.goto('/stock');
  await page.getByRole('searchbox').fill(item.code);
  await expect(page.getByRole('row').filter({ hasText: item.code }).first()).toBeVisible({ timeout: 15_000 });
  await expect(await tableCell(page, item.code, 'Free')).toHaveText(/^5\b/, { timeout: 15_000 });
  await expect(await tableCell(page, item.code, 'Reserved')).toHaveText(/^5\b/);
});
