// @e2e-isolation: self-isolated — owns its Project Manager login, contract, work order, contract line, material allowance, acceptance, item and yard; sets the organisation's issued-versus-progress threshold for the run and clears it in finally.
import { managedProject } from "./support/managedProject";
// JOB-M5 (acceptance 01-management, TC-M-05): material out matches progress. A work order with 80% of its material issued
// and 40% progress: the Project Manager opens the project's Work orders tab, opens the work order's stock, and the issued
// share is shown against the progress share with a warning. (The acceptance script names "Work orders → [Work order] →
// Material"; the shipped screen is the work order card's stock section on the project's Work orders tab, walk M5.)
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { need, ok, ORG_ID, runId, serviceClient, sqlAsOwner } from './support/jobFixtures';
import { orgToday } from './support/jobJourney';
import { roleJobUser } from './support/roleJobUser';
import { makeItem, makeWarehouse, postReceive, runSuffix, userClient } from './support/stockFixture';

test.setTimeout(180_000);

type Actor = Awaited<ReturnType<typeof roleJobUser>>;

test('JOB-M5 the Project Manager sees the issued share against the progress share, with a warning', async ({ page }) => {
  const svc = serviceClient('JOB-M5');
  const run = runId('JOBM5');
  const suffix = runSuffix();
  const actor: Actor = await roleJobUser(svc, 'project_manager', run);
  const stock = await userClient('admin@acme.test'); // the Admin who keeps stock (a real JWT: the stock RPCs read auth.uid())
  let projectId = ''; let woId = ''; let boqId = ''; let acceptanceId = ''; let receiptId = ''; let issueId = '';
  let itemId = ''; let siteId = '';

  try {
    const clientId = need('client', await svc.from('companies').insert({ org_id: ORG_ID, name: `${run} client`, type: 'Client' }).select('id').single()).id as string;
    projectId = need('project', await svc.from('projects').insert(managedProject(actor.id, {
      org_id: ORG_ID, name: `${run} contract`, status: 'Ongoing Project', currency: 'USD', client_id: clientId,
      contract_value: 100_000, tax_treatment: 'exclusive', tax_amount: 0,
    })).select('id').single()).id as string;
    woId = randomUUID();
    ok('work order', await svc.from('work_orders').insert({
      id: woId, org_id: ORG_ID, project_id: projectId, title: `${run} line`, wo_number: `WO-${run}`, status: 'Issued',
      issued_at: new Date().toISOString(), order_value: 50_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD',
    }));
    boqId = need('contract line', await svc.from('boq_items').insert({
      org_id: ORG_ID, project_id: projectId, item_code: `L-${suffix}`, description: `${run} measured work`, unit: 'm', quantity: 100, rate: 10,
    }).select('id').single()).id as string;
    ok('work-order line', await svc.from('work_order_lines').insert({ org_id: ORG_ID, work_order_id: woId, boq_item_id: boqId, quantity: 100 }));
    // The planned material on the line: 100. 80 leaves for the site while only 40% of the work is accepted.
    const item = await makeItem(stock, suffix, 'M5');
    itemId = item.id;
    ok('material allowance', await svc.from('boq_material_allowances').insert({ org_id: ORG_ID, boq_item_id: boqId, item_id: itemId, planned_quantity: 100 }));
    acceptanceId = randomUUID();
    const me = (await stock.auth.getUser()).data.user!.id;
    ok('acceptance', await svc.from('work_order_acceptances').insert({
      id: acceptanceId, org_id: ORG_ID, project_id: projectId, work_order_id: woId, acceptance_date: orgToday(),
      is_final: false, status: 'Confirmed', prepared_by: me, confirmed_by: me, confirmed_at: new Date().toISOString(), confirm_basis: 'sole_operator',
    }));
    ok('accepted 40%', await svc.from('work_order_acceptance_lines').insert({ acceptance_id: acceptanceId, boq_item_id: boqId, quantity: 40 }));
    const yard = await makeWarehouse(stock, suffix, 'M5', 'central');
    siteId = yard.id;
    receiptId = await postReceive(stock, yard.id, itemId, '100', '2');
    // The Admin's stated threshold: warn once issued runs more than 20 points ahead of progress. Set before the issue
    // posts, so the posting itself raises the alert the card counts (FR-MVP-002).
    ok('threshold', await stock.rpc('set_work_order_issue_threshold', { p_threshold_pct: 20 }));
    const issue = await stock.rpc('create_stock_document', {
      p_header: { kind: 'issue', warehouse_id: yard.id, project_id: projectId },
      p_lines: [{ item_id: itemId, quantity: '80', boq_item_id: boqId }], p_post: true,
    });
    if (issue.error) throw new Error('issue: ' + issue.error.message);
    issueId = issue.data as string;
    ok('attribution', await stock.rpc('set_cost_attribution', { p_source: 'stock_document', p_ids: [issueId], p_work_order_id: woId, p_discipline_id: null }));

    await actor.signIn(page);
    // Projects → [Contract] → Work orders: the contract the Project Manager reviews.
    await page.goto('/projects');
    await page.getByRole('searchbox', { name: /Search projects/i }).fill(`${run} contract`);
    await page.getByRole('link', { name: new RegExp(`${run} contract`) }).first().click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}`));
    // The contract area, focused on the work order, holds its card.
    await page.goto(`/projects/${projectId}/contract?wo=${woId}`);
    const card = page.getByTestId(`customer-order-${woId}`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    // The card says how many items run ahead, before the stock section is opened (FR-MVP-008).
    await expect(card).toContainText('1 item ahead of progress');
    // Open its material (the work order's stock section): the warning names the item.
    await card.getByRole('button', { name: 'Stock for this work order', exact: true }).click();
    await expect(card.getByText('Items issued ahead of progress: 1')).toBeVisible();
    // The warning names the item with its issued share and its lead over progress (40%, stated once above the rows).
    const warned = card.getByRole('row').filter({ hasText: item.name }).filter({ hasText: '40 points' });
    await expect(warned).toContainText('80%');
    await expect(card.getByText(/progress \(40%\)/)).toBeVisible();
    await expect(card.getByRole('table', { name: 'Stock for this work order' }).getByRole('row').filter({ hasText: item.name })).toBeVisible();
  } finally {
    try { await stock.rpc('set_work_order_issue_threshold', { p_threshold_pct: null }); } catch { /* the database is gone mid-run */ }
    const ids = { projectId, woId, boqId, acceptanceId, receiptId, issueId, itemId, siteId };
    if (ids.projectId) {
      sqlAsOwner(`do $$ begin
        delete from public.stock_ledger where document_id in ('${ids.receiptId}', '${ids.issueId}');
        delete from public.stock_document_lines where document_id in ('${ids.receiptId}', '${ids.issueId}');
        delete from public.stock_documents where id in ('${ids.receiptId}', '${ids.issueId}');
        delete from public.stock_balances where warehouse_id = '${ids.siteId}';
        delete from public.work_order_acceptance_lines where acceptance_id = '${ids.acceptanceId}';
        delete from public.work_order_acceptances where id = '${ids.acceptanceId}';
        delete from public.boq_material_allowances where boq_item_id = '${ids.boqId}';
        delete from public.work_order_lines where work_order_id = '${ids.woId}';
        delete from public.work_order_plan_lines where work_order_id = '${ids.woId}';
        delete from public.work_orders where id = '${ids.woId}';
        delete from public.boq_items where id = '${ids.boqId}';
        delete from public.projects where id = '${ids.projectId}';
      end $$;`);
    }
    if (ids.siteId) sqlAsOwner(`delete from public.stock_warehouses where id = '${ids.siteId}';`);
    if (ids.itemId) {
      sqlAsOwner(`delete from public.boq_material_allowances where item_id = '${ids.itemId}'; delete from public.stock_items where id = '${ids.itemId}';`);
      ok('unit cleanup', await svc.from('stock_units').delete().eq('code', `E2E-U${suffix}`));
    }
    await actor.cleanup();
  }
});
