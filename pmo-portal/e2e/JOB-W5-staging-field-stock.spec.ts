// @e2e-isolation: self-isolated — unique item, locations, work item and work order per run; the posted ledger is append-only so codes carry a per-run suffix.
/** JOB-W5 — a staging area is a stock location; with 30 dispatched and 20 reported installed its field stock reads 10 on the work order. */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';
import { serviceClient } from './support/jobFixtures';
import { makeItem, makeWarehouse, makeWorkItem, postReceive, runSuffix, userClient, SEED_PROJECT_ID } from './support/stockFixture';

test.setTimeout(180_000);

test('JOB-W5 staging stock reads dispatched minus installed', async ({ page }) => {
  const sfx = runSuffix();
  const number = `WO-W5-${sfx}`;
  const workOrderId = randomUUID();
  const admin = await userClient('admin@acme.test');
  const service = serviceClient('JOB-W5');
  const project = await service.from('projects').select('org_id,currency').eq('id', SEED_PROJECT_ID).single();
  if (project.error) throw project.error;
  const wo = await service.from('work_orders').insert({ id: workOrderId, org_id: project.data.org_id, project_id: SEED_PROJECT_ID,
    title: `Staging work ${sfx}`, wo_number: number, status: 'Issued', issued_at: new Date().toISOString(),
    order_value: 10000, tax_treatment: 'exclusive', tax_amount: 0, currency: project.data.currency });
  if (wo.error) throw wo.error;
  const item = await makeItem(admin, sfx, 'STG');
  const central = await makeWarehouse(admin, sfx, 'CEN', 'central');
  const work = await makeWorkItem(admin, sfx);
  const st = await admin.from('stock_warehouses').insert({ code: `E2E-STG${sfx}`, name: `Staging ${sfx}`, kind: 'staging', project_id: SEED_PROJECT_ID }).select('id,code,name').single();
  if (st.error) throw st.error;
  await postReceive(admin, central.id, item.id, '30', '25');
  const move = await admin.rpc('create_stock_document', { p_header: { kind: 'transfer', warehouse_id: central.id, to_warehouse_id: st.data.id }, p_lines: [{ item_id: item.id, quantity: '30' }], p_post: true });
  if (move.error) throw move.error;
  const a1 = await admin.rpc('set_cost_attribution', { p_source: 'stock_document', p_ids: [move.data], p_work_order_id: workOrderId, p_discipline_id: null });
  if (a1.error) throw a1.error;
  const issue = await admin.rpc('create_stock_document', { p_header: { kind: 'issue', warehouse_id: st.data.id, project_id: SEED_PROJECT_ID }, p_lines: [{ item_id: item.id, quantity: '20', boq_item_id: work.id }], p_post: true });
  if (issue.error) throw issue.error;
  const a2 = await admin.rpc('set_cost_attribution', { p_source: 'stock_document', p_ids: [issue.data], p_work_order_id: workOrderId, p_discipline_id: null });
  if (a2.error) throw a2.error;

  await signIn(page, 'pm@acme.test');
  await page.goto(`/projects/${SEED_PROJECT_ID}/contract?wo=${workOrderId}`);
  const card = page.getByTestId(`customer-order-${workOrderId}`);
  await card.getByRole('button', { name: 'Stock for this work order' }).click();
  const row = card.getByRole('row').filter({ hasText: st.data.code });
  await expect(row.getByRole('cell').nth(4)).toHaveText('20');
  await expect(row.getByRole('cell').nth(5)).toContainText('10');
});
