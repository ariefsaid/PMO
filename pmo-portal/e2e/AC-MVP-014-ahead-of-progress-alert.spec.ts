// @e2e-isolation: self-isolated - unique item, location, BoQ line, work order and acceptance per run; the org-wide threshold is set for the
// journey and cleared in `finally`; only a work order carrying a material allowance can warn, and only this run's does. The project manager
// reads their own notification, which names this run's work order number.
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { test, expect } from '@playwright/test';
import { requireServiceRoleKey, signIn } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';
import { makeItem, makeWarehouse, makeWorkItem, postReceive, runSuffix, SEED_PROJECT_ID, userClient } from './support/stockFixture';

test.setTimeout(180_000);

test('AC-MVP-014 material issued ahead of progress tells the project manager, who follows it to the work order, and nothing is blocked', async ({ page }) => {
  const sfx = runSuffix();
  const number = `WO-MVP-${sfx}`;
  const workOrderId = randomUUID();
  const admin = await userClient('admin@acme.test');
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-MVP-014 needs the local service-role fixture client');
  const service = createClient(requireMatchingLocalSupabaseUrls(undefined, undefined), key, { auth: { persistSession: false } });
  const project = await service.from('projects').select('org_id,currency').eq('id', SEED_PROJECT_ID).single();
  if (project.error) throw project.error;
  const order = await service.from('work_orders').insert({ id: workOrderId, org_id: project.data.org_id, project_id: SEED_PROJECT_ID,
    title: `Ahead alert ${sfx}`, wo_number: number, status: 'Issued', issued_at: new Date().toISOString(),
    order_value: 10000, tax_treatment: 'exclusive', tax_amount: 0, currency: project.data.currency });
  if (order.error) throw order.error;
  const item = await makeItem(admin, sfx, 'MVP');
  const central = await makeWarehouse(admin, sfx, 'CEN', 'central');
  const work = await makeWorkItem(admin, sfx);
  // The work order holds the whole BoQ line (quantity 100); 10 of it is accepted: progress 10%. Planned material 100, issued 60: 60%.
  const line = await service.from('boq_items').select('quantity').eq('id', work.id).single();
  if (line.error) throw line.error;
  const alloc = await service.from('work_order_lines').insert({ org_id: project.data.org_id, work_order_id: workOrderId, boq_item_id: work.id, quantity: line.data.quantity });
  if (alloc.error) throw alloc.error;
  const allowance = await service.from('boq_material_allowances').insert({ org_id: project.data.org_id, boq_item_id: work.id, item_id: item.id, planned_quantity: 100 });
  if (allowance.error) throw allowance.error;
  const acceptanceId = randomUUID();
  const who = (await admin.auth.getUser()).data.user?.id;
  const acceptance = await service.from('work_order_acceptances').insert({ id: acceptanceId, org_id: project.data.org_id, project_id: SEED_PROJECT_ID, work_order_id: workOrderId,
    acceptance_date: new Date().toISOString().slice(0, 10), is_final: false, status: 'Confirmed', prepared_by: who, confirmed_by: who, confirmed_at: new Date().toISOString(), confirm_basis: 'sole_operator' });
  if (acceptance.error) throw acceptance.error;
  const accepted = await service.from('work_order_acceptance_lines').insert({ acceptance_id: acceptanceId, boq_item_id: work.id, quantity: Number(line.data.quantity) / 10 });
  if (accepted.error) throw accepted.error;
  await postReceive(admin, central.id, item.id, '100', '2');

  try {
    // The Admin sets the threshold, then issues 60: past it, so the alert is raised by the posting itself (nobody opens a screen).
    const threshold = await admin.rpc('set_work_order_issue_threshold', { p_threshold_pct: 20 });
    expect(threshold.error).toBeNull();
    const issue = await admin.rpc('create_stock_document', { p_header: { kind: 'issue', warehouse_id: central.id, project_id: SEED_PROJECT_ID },
      p_lines: [{ item_id: item.id, quantity: '60', boq_item_id: work.id }], p_post: true });
    if (issue.error) throw issue.error;
    const attribution = await admin.rpc('set_cost_attribution', { p_source: 'stock_document', p_ids: [issue.data], p_work_order_id: workOrderId, p_discipline_id: null });
    if (attribution.error) throw attribution.error;

    // The project manager finds it in the bell, naming the work order, and follows it to the project's work orders.
    await signIn(page, 'pm@acme.test');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: /notifications/i }).click();
    await page.getByRole('button', { name: /Material issued ahead of progress/ }).filter({ hasText: number }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${SEED_PROJECT_ID}/work-orders`));

    // The card shows the count without opening the stock section; opening it shows the figures.
    const card = page.getByTestId(`customer-order-${workOrderId}`);
    await expect(card.getByRole('button', { name: /1 item ahead of progress/ })).toBeVisible();
    await card.getByRole('button', { name: /1 item ahead of progress/ }).click();
    await expect(card.getByText(new RegExp(`${item.name}: issued 60% of planned, progress 10%, 50 points ahead`))).toBeVisible();

    // The alert blocked nothing: another issue still posts.
    const another = await admin.rpc('create_stock_document', { p_header: { kind: 'issue', warehouse_id: central.id, project_id: SEED_PROJECT_ID },
      p_lines: [{ item_id: item.id, quantity: '1', boq_item_id: work.id }], p_post: true });
    expect(another.error).toBeNull();
  } finally {
    await admin.rpc('set_work_order_issue_threshold', { p_threshold_pct: null });
  }
});
