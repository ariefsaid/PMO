// @e2e-isolation: self-isolated — creates its own uniquely named unit, tag, item, site location and work order each run (stock and requisition history are append-only, so none is deleted); keeps the location with the seed Engineer.
/**
 * AC-CSR-019 — goal: a keeper on a phone raises a client requisition from the take-off, the client's reservation is
 * recorded, the material is picked up, and the work order shows reserved, collected and still to collect (the hand
 * calculation of AC-CSR-001: 70 / 50 / 20, 30 awaiting) while stock holds the material at zero value.
 */
import { test, expect, type Page } from '@playwright/test';
import { signIn } from './helpers';
import { SEED_PROJECT_ID, keeperOf, runSuffix, userClient } from './support/stockFixture';
import { openWorkOrderArea } from './support/workOrderArea';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
test.setTimeout(240_000);

async function fixture() {
  const sfx = runSuffix();
  const admin = await userClient('admin@acme.test');
  const orgId = (await admin.from('projects').select('org_id').eq('id', SEED_PROJECT_ID).single()).data?.org_id as string;
  const unit = await admin.from('stock_units').insert({ code: `E2E-CU${sfx}`, name: `E2E unit ${sfx}`, whole_only: true }).select('id, code').single();
  if (unit.error) throw new Error('unit: ' + unit.error.message);
  const tag = await admin.from('stock_tags').insert({ name: `Client supplied ${sfx}`, zero_cost: true }).select('id').single();
  if (tag.error) throw new Error('tag: ' + tag.error.message);
  const item = await admin.from('stock_items').insert({ code: `E2E-CM${sfx}`, name: `E2E cement ${sfx}`, unit_id: unit.data.id, tag_id: tag.data.id }).select('id, code, name').single();
  if (item.error) throw new Error('item: ' + item.error.message);
  const draft = await admin.from('work_orders').insert({
    org_id: orgId, project_id: SEED_PROJECT_ID, title: `E2E CSR ${sfx}`, order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0,
  }).select('id').single();
  if (draft.error) throw new Error('work order: ' + draft.error.message);
  let issue = await admin.rpc('transition_work_order', { p_id: draft.data.id, p_to: 'Issued' });
  if (issue.error && /acknowledg/i.test(issue.error.message)) issue = await admin.rpc('transition_work_order', { p_id: draft.data.id, p_to: 'Issued', p_over_commit_ack: true });
  if (issue.error) throw new Error('work order issue: ' + issue.error.message);
  const site = await admin.from('stock_warehouses').insert({ code: `E2E-CS${sfx}`, name: `E2E site ${sfx}`, kind: 'site', project_id: SEED_PROJECT_ID }).select('id, code, name').single();
  if (site.error) throw new Error('site: ' + site.error.message);
  await keeperOf(admin, site.data.id);
  return { admin, item: item.data, unit: unit.data, woId: draft.data.id as string, site: site.data };
}

async function openSection(page: Page, woId: string) {
  await page.goto(`/work-orders/${woId}`);
  await openWorkOrderArea(page, 'material');
  await expect(page.getByTestId('client-material-section')).toBeVisible({ timeout: 20_000 });
}

test('AC-CSR-019: a keeper raises a requisition, the client reserves, the keeper picks up, and the work order shows the figures with stock at zero value', async ({ page }) => {
  const { admin, item, unit, woId, site } = await fixture();
  const total = () => page.getByTestId(`csr-total-${item.id}-${unit.code}`);

  // The keeper (the Engineer) raises the requisition from the take-off and sends it.
  await signIn(page, 'engineer@acme.test');
  await openSection(page, woId);
  await expect(page.getByTestId('csr-empty')).toBeVisible();                       // no requisition yet: an empty state, not zeros
  await page.getByRole('button', { name: 'New requisition' }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Client reference').fill('CL-REQ-1');
  await form.getByLabel(/^Item/).selectOption({ label: `${item.code} · ${item.name} (${unit.code})` });
  await form.getByLabel(/Take-off quantity/).fill('100');
  await form.getByLabel(/Requested quantity/).fill('100');
  await form.getByRole('button', { name: 'Create requisition' }).click();
  await expect(form).toBeHidden({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Send to client' }).click();
  await expect(page.getByText('Open', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(total().getByTestId('csr-awaiting')).toHaveText('100');

  // A Project Manager records the client's reservations (60 and 20) and a release (10).
  await signIn(page, 'pm@acme.test');
  await openSection(page, woId);
  for (const [qty, ref] of [['60', 'CL-RSV-1'], ['20', 'CL-RSV-2']] as const) {
    await page.getByRole('button', { name: 'Record reservation' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel(/Quantity reserved/).fill(qty);
    await dlg.getByLabel(/Client's reference/).fill(ref);
    await dlg.getByRole('button', { name: 'Record reservation' }).click();
    await expect(dlg).toBeHidden({ timeout: 15_000 });
  }
  await page.getByRole('button', { name: 'Record release' }).click();
  const rel = page.getByRole('dialog');
  await rel.getByLabel(/Quantity released/).fill('10');
  await rel.getByLabel(/Reason/).fill('client took 10 back');
  await rel.getByRole('button', { name: 'Record release' }).click();
  await expect(rel).toBeHidden({ timeout: 15_000 });
  await expect(total().getByTestId('csr-reserved')).toHaveText('70');

  // Reserving more than was requested is refused in words.
  await page.getByRole('button', { name: 'Record reservation' }).click();
  const over = page.getByRole('dialog');
  await over.getByLabel(/Quantity reserved/).fill('31');
  await over.getByLabel(/Client's reference/).fill('CL-RSV-3');
  await over.getByRole('button', { name: 'Record reservation' }).click();
  await expect(over.getByText('Reserved would exceed requested by 1.')).toBeVisible();
  await over.getByRole('button', { name: 'Cancel' }).click();

  // The keeper picks up 50 into the site location.
  await signIn(page, 'engineer@acme.test');
  await openSection(page, woId);
  await page.getByRole('button', { name: 'Record pickup' }).click();
  const pick = page.getByRole('dialog');
  await pick.getByLabel(/Quantity collected/).fill('50');
  await pick.getByLabel(/Collected by/).fill('Driver Budi');
  await expect(pick.getByLabel(/Received at/)).toHaveValue(site.id);
  await pick.getByRole('button', { name: 'Record pickup' }).click();
  await expect(pick).toBeHidden({ timeout: 20_000 });

  // The work order shows the hand calculation: reserved 70, collected 50, still to collect 20, awaiting reservation 30.
  await expect(total().getByTestId('csr-reserved')).toHaveText('70');
  await expect(total().getByTestId('csr-collected')).toHaveText('50');
  await expect(total().getByTestId('csr-still')).toHaveText('20');
  await expect(total().getByTestId('csr-awaiting')).toHaveText('30');

  // Stock holds the 50 at the site, at zero value, against this work order.
  const balance = await admin.rpc('get_work_order_stock_balance', { p_work_order_id: woId });
  if (balance.error) throw new Error('balance: ' + balance.error.message);
  const row = (balance.data as Array<Record<string, string>>).find((r) => r.item_id === item.id);
  expect(row?.on_site_qty).toBe('50');
  expect(Number(row?.on_site_value)).toBe(0);
});
