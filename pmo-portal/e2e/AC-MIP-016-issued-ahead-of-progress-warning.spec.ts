// @e2e-isolation: self-isolated - unique item, location, BoQ line, work order and acceptance per run; the org-wide threshold is set for the
// journey and cleared in `finally`; only a work order carrying a material allowance can warn, and only this run's does.
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { test, expect } from '@playwright/test';
import { requireServiceRoleKey, signIn } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';
import { makeItem, makeWarehouse, makeWorkItem, postReceive, runSuffix, SEED_PROJECT_ID, userClient } from './support/stockFixture';
import { orgToday } from './support/jobJourney';

test.setTimeout(180_000);

test('AC-MIP-016 an Admin sets the threshold and the work order that is issued ahead of progress shows the warning, without blocking', async ({ page }) => {
  const sfx = runSuffix();
  const number = `WO-MIP-${sfx}`;
  const workOrderId = randomUUID();
  const admin = await userClient('admin@acme.test');
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-MIP-016 needs the local service-role fixture client');
  const service = createClient(requireMatchingLocalSupabaseUrls(undefined, undefined), key, { auth: { persistSession: false } });
  const project = await service.from('projects').select('org_id,currency').eq('id', SEED_PROJECT_ID).single();
  if (project.error) throw project.error;
  const order = await service.from('work_orders').insert({ id: workOrderId, org_id: project.data.org_id, project_id: SEED_PROJECT_ID,
    title: `Issued ahead ${sfx}`, wo_number: number, status: 'Issued', issued_at: new Date().toISOString(),
    order_value: 10000, tax_treatment: 'exclusive', tax_amount: 0, currency: project.data.currency });
  if (order.error) throw order.error;
  const item = await makeItem(admin, sfx, 'MIP');
  const central = await makeWarehouse(admin, sfx, 'CEN', 'central');
  const work = await makeWorkItem(admin, sfx);
  // The work order holds the whole BoQ line (quantity 100 at its rate); 10 of it is accepted: progress 10%. Planned material 100, issued 60: 60%.
  const line = await service.from('boq_items').select('quantity').eq('id', work.id).single();
  if (line.error) throw line.error;
  const alloc = await service.from('work_order_lines').insert({ org_id: project.data.org_id, work_order_id: workOrderId, boq_item_id: work.id, quantity: line.data.quantity });
  if (alloc.error) throw alloc.error;
  const allowance = await service.from('boq_material_allowances').insert({ org_id: project.data.org_id, boq_item_id: work.id, item_id: item.id, planned_quantity: 100 });
  if (allowance.error) throw allowance.error;
  const acceptanceId = randomUUID();
  const who = (await admin.auth.getUser()).data.user?.id;
  const acceptance = await service.from('work_order_acceptances').insert({ id: acceptanceId, org_id: project.data.org_id, project_id: SEED_PROJECT_ID, work_order_id: workOrderId,
    acceptance_date: orgToday(), is_final: false, status: 'Confirmed', prepared_by: who, confirmed_by: who, confirmed_at: new Date().toISOString(), confirm_basis: 'sole_operator' });
  if (acceptance.error) throw acceptance.error;
  const accepted = await service.from('work_order_acceptance_lines').insert({ acceptance_id: acceptanceId, boq_item_id: work.id, quantity: Number(line.data.quantity) / 10 });
  if (accepted.error) throw accepted.error;
  await postReceive(admin, central.id, item.id, '100', '2');
  const issue = await admin.rpc('create_stock_document', { p_header: { kind: 'issue', warehouse_id: central.id, project_id: SEED_PROJECT_ID },
    p_lines: [{ item_id: item.id, quantity: '60', boq_item_id: work.id }], p_post: true });
  if (issue.error) throw issue.error;
  const attribution = await admin.rpc('set_cost_attribution', { p_source: 'stock_document', p_ids: [issue.data], p_work_order_id: workOrderId, p_discipline_id: null });
  if (attribution.error) throw attribution.error;

  try {
    await signIn(page, 'admin@acme.test');
    await page.setViewportSize({ width: 1440, height: 900 });
    // Off by default: the stock balance shows no warning.
    await page.goto(`/projects/${SEED_PROJECT_ID}/contract?wo=${workOrderId}`);
    let card = page.getByTestId(`customer-order-${workOrderId}`);
    await card.getByRole('button', { name: 'Stock for this work order' }).click();
    // The table's item column shows the item's name (the location column shows the warehouse code), so the row is found by name.
    await expect(card.getByRole('table', { name: 'Stock for this work order' }).getByRole('row').filter({ hasText: item.name })).toBeVisible();
    await expect(card.getByText(/issued ahead of progress/i)).toHaveCount(0);

    // The Admin sets the threshold in stock setup.
    await page.goto('/stock/setup');
    await page.getByRole('button', { name: 'Issued-versus-progress warning' }).click();
    await page.getByLabel(/Warn when issued exceeds progress by/).fill('20');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved.')).toBeVisible();

    // Issued 60% against progress 10%: the warning shows with the figures, and the work order is still usable.
    await page.goto(`/projects/${SEED_PROJECT_ID}/contract?wo=${workOrderId}`);
    card = page.getByTestId(`customer-order-${workOrderId}`);
    await card.getByRole('button', { name: 'Stock for this work order' }).click();
    await expect(card.getByText('Items issued ahead of progress: 1')).toBeVisible();
    // The warning names the item with its issued share and its lead over progress (10%, stated once above the rows).
    const warned = card.getByRole('row').filter({ hasText: item.name }).filter({ hasText: '50 points' });
    await expect(warned).toContainText('60%');
    await expect(card.getByText(/progress \(10%\)/)).toBeVisible();
    await expect(card.getByRole('table', { name: 'Stock for this work order' }).getByRole('row').filter({ hasText: item.name })).toBeVisible();
    const another = await admin.rpc('create_stock_document', { p_header: { kind: 'issue', warehouse_id: central.id, project_id: SEED_PROJECT_ID },
      p_lines: [{ item_id: item.id, quantity: '1', boq_item_id: work.id }], p_post: true });
    expect(another.error).toBeNull();
  } finally {
    await admin.rpc('set_work_order_issue_threshold', { p_threshold_pct: null });
  }
});
