// @e2e-isolation: self-isolated — unique item, central warehouse, work item and work order per run; the posted ledger is append-only so codes carry a per-run suffix.
/** JOB-PU16 — stock bought in bulk is held centrally with no work order; issuing 20 units to a work order raises that work order's material cost by 20 units at stock cost. */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';
import { serviceClient } from './support/jobFixtures';
import { makeItem, makeWarehouse, makeWorkItem, postReceive, runSuffix, userClient, SEED_PROJECT_ID, SEED_PROJECT_NAME } from './support/stockFixture';
import { chooseItem, chooseWorkOrder, label } from './support/jobStock';

test.setTimeout(180_000);

test('JOB-PU16 issuing 20 of a bulk stock to a work order charges it 20 units at stock cost', async ({ page }) => {
  const sfx = runSuffix();
  const number = `WO-PU16-${sfx}`;
  const workOrderId = randomUUID();
  const admin = await userClient('admin@acme.test');
  const service = serviceClient();
  const project = await service.from('projects').select('org_id,currency').eq('id', SEED_PROJECT_ID).single();
  if (project.error) throw project.error;
  const wo = await service.from('work_orders').insert({ id: workOrderId, org_id: project.data.org_id, project_id: SEED_PROJECT_ID,
    title: `Bulk site work ${sfx}`, wo_number: number, status: 'Issued', issued_at: new Date().toISOString(),
    order_value: 10000, tax_treatment: 'exclusive', tax_amount: 0, currency: project.data.currency });
  if (wo.error) throw wo.error;
  const item = await makeItem(admin, sfx, 'BULK');
  const central = await makeWarehouse(admin, sfx, 'CEN', 'central');
  const work = await makeWorkItem(admin, sfx);
  await postReceive(admin, central.id, item.id, '100', '25');

  await signIn(page, 'admin@acme.test');
  await page.goto('/stock/new/issue');
  await page.getByLabel(/^Warehouse/).selectOption({ label: label(central) });
  await page.getByLabel(/^Project/).selectOption({ label: SEED_PROJECT_NAME });
  await page.getByLabel(/^Work item/).selectOption({ label: `${work.item_code} - ${work.description}` });
  await chooseWorkOrder(page, number);
  await chooseItem(page, item.code);
  await page.getByLabel(/^Quantity/).fill('20');
  await page.getByRole('button', { name: 'Post issue' }).click();
  await expect(page).toHaveURL(/\/stock\/documents\/[0-9a-f-]{36}$/, { timeout: 20_000 });

  // The work order's stock balance: 20 issued at 25 each = 500.
  await page.goto(`/projects/${SEED_PROJECT_ID}/contract?wo=${workOrderId}`);
  const card = page.getByTestId(`customer-order-${workOrderId}`);
  await card.getByRole('button', { name: 'Stock for this work order' }).click();
  const row = card.getByRole('row').filter({ hasText: central.code });
  await expect(row).toContainText('20');
  await expect(row).toContainText('500');
});
