// @e2e-isolation: self-isolated — creates its own work order, item, section and coordinator login per run; the loaded opening rows are append-only history and stay.
/**
 * AC-007 (#3010) — goal: the Material Coordinator, at their ordinary access level (Engineer + job role), opens a work order,
 * picks a location, reads its stages, records the reconciliation step and sees it on the Work Orders Materials rollup.
 * The Admin prepares what an Admin prepares: the step scale and the loaded opening position (contract v2 import).
 * Payload shape: supabase/tests/2791_owner_material_import.test.sql.
 */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { need, ok, runId, serviceClient } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';
import { makeItem, runSuffix, SEED_PROJECT_ID, userClient } from './support/stockFixture';
import { openWorkOrderArea } from './support/workOrderArea';

test.setTimeout(300_000);

test('AC-007: the Material Coordinator reads a location\'s stages, records its reconciliation step, and sees it on the Work Orders rollup', async ({ page }) => {
  const svc = serviceClient('AC-007');
  const admin = await userClient('admin@acme.test');
  const sfx = runSuffix();
  const coordinator = await roleJobUser(svc, 'material_coordinator', runId('om-mc'));
  const workOrderId = randomUUID();
  const number = `WO-OM-${sfx}`;
  const project = need('project', await svc.from('projects').select('org_id,currency').eq('id', SEED_PROJECT_ID).single());
  ok('work order', await svc.from('work_orders').insert({ id: workOrderId, org_id: project.org_id, project_id: SEED_PROJECT_ID,
    title: `Owner material ${sfx}`, wo_number: number, status: 'Draft',
    order_value: 10000, tax_treatment: 'exclusive', tax_amount: 0, currency: project.currency }));
  const item = await makeItem(admin, sfx, 'OM');
  const unitCode = `E2E-U${sfx}`;
  // The loaded material is the owner's: its item carries the organisation's zero-cost tag.
  const tag = need('tag', await admin.from('stock_tags').insert({ name: `Owner material ${sfx}`, zero_cost: true }).select('id').single());
  ok('tag the item', await admin.from('stock_items').update({ tag_id: tag.id }).eq('id', item.id));

  // The Admin sets the scale and loads the location's opening position (what the workbook command does).
  ok('scale', await admin.rpc('om_material_set_scale', { p_steps: [
    { name: 'Prepared', position: 1, percentage: 20 }, { name: 'Checked', position: 2, percentage: 40 }, { name: 'Submitted', position: 3, percentage: 60 },
    { name: 'Agreed', position: 4, percentage: 80 }, { name: 'Closed', position: 5, percentage: 100 }] }));
  ok('load', await admin.rpc('om_material_import', { p_source_key: `ac007-${sfx}`, p_schema_version: 2, p_confirm: true, p_payload: {
    kind: 'section', project_id: SEED_PROJECT_ID, source_digest: sfx, entities: [{
      entity_key: `sec-${sfx}`, hash: `h-${sfx}`, sheet: 'S1', row: 1, owner_order_number: number, location_name: `North ${sfx}`, section_code: `N${sfx.slice(-4)}`, owner_cost_code: 'CC-1', title: `North ${sfx}`,
      as_of: '2026-11-15',
      lines: [{ entity_key: `ln-${sfx}`, hash: `lh-${sfx}`, row: 2, item_code: item.code, unit: unitCode, category_code: null, planned: '100',
        opening: { requested: '80', set_aside: '60', received: '40', issued: '25', returned: '0', transfer_in: '0', transfer_out: '0', owner_return: '0' },
        evidence: { request_reference: 'REQ-1 on 3 Oct' }, expected: { closing: '15' } }] }] } }));

  await coordinator.signIn(page);
  await page.goto(`/work-orders/${workOrderId}`);
  await openWorkOrderArea(page, 'material');
  const pipeline = page.getByTestId('owner-material-pipeline');
  await expect(pipeline).toBeVisible({ timeout: 20_000 });
  await expect(pipeline.getByTestId('om-as-of')).toBeVisible();
  const row = pipeline.locator('[data-testid^="om-row-"]').first();
  await expect(row.getByTestId('om-received')).toContainText('40');
  await expect(row.getByTestId('om-closing')).toContainText('15');

  await pipeline.getByTestId('om-step-select').selectOption({ label: 'Checked · 40%' });
  await pipeline.getByRole('button', { name: 'Record step' }).click();
  await expect(pipeline.getByTestId('om-step')).toHaveText('Checked · 40%', { timeout: 15_000 });

  // The Work Orders Materials view carries it (the work order's lowest location step).
  await page.goto(`/work-orders?view=materials&project=${SEED_PROJECT_ID}`);
  await expect(page.getByTestId(`omr-row-${workOrderId}`).getByTestId('omr-step')).toContainText('Checked · 40%', { timeout: 20_000 });
});
