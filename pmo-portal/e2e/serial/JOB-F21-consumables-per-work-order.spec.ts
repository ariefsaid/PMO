// @e2e-isolation: serial — turns the organisation-wide "a validated daily report issues stock" setting on for the run and restores it; the stock ledger is append-only, so every item and document code carries a per-run suffix.
/**
 * JOB-F21 — consumables per work order per day (#2676). The project administrator enters the consumables used on today's daily
 * report; the project manager validates it.
 * Goal oracle: the stock issue posts to that work order (the report shows the issue number, and the posted document names the
 * work order), and the site store's on-hand figure falls by what the report used.
 */
import { test, expect } from '@playwright/test';
import { ORG_ID, need, ok, runId, serviceClient, sqlAsOwner } from '../support/jobFixtures';
import { roleJobUser } from '../support/roleJobUser';
import { makeItem, makeWarehouse, postReceive, runSuffix, userClient } from '../support/stockFixture';

test.setTimeout(240_000);

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test('JOB-F21 the project administrator enters consumables on the daily report and validation issues them to the work order', async ({ page }) => {
  const svc = serviceClient('JOB-F21');
  const admin = await userClient('admin@acme.test');
  const run = runId('f21');
  const sfx = runSuffix();
  const pa = await roleJobUser(svc, 'project_administrator', runId('f21-pa'));
  const pm = await roleJobUser(svc, 'project_manager', runId('f21-pm'));
  let issueBefore: boolean | null = null;
  let scopeBefore: string | null = null;
  let stockTouched = false;
  let projectId = '';
  let workOrderId = '';
  let warehouseId = '';
  let itemId = '';
  try {
    const org = need('org setting read', await svc.from('organizations').select('dsr_stock_issue, dsr_stock_issue_items').eq('id', ORG_ID).single());
    issueBefore = (org.dsr_stock_issue as boolean | null) ?? null; scopeBefore = (org.dsr_stock_issue_items as string | null) ?? null;
    ok('org setting on', await svc.from('organizations').update({ dsr_stock_issue: true, dsr_stock_issue_items: 'all' }).eq('id', ORG_ID));
    stockTouched = true;

    projectId = need('project', await svc.from('projects').insert({
      org_id: ORG_ID, name: `${run} project`, status: 'Ongoing Project', currency: 'USD', project_manager_id: pm.id,
    }).select('id').single()).id;
    const site = await makeWarehouse(admin, sfx, 'F21', 'site', projectId);
    warehouseId = site.id;
    workOrderId = need('work order', await svc.from('work_orders').insert({
      org_id: ORG_ID, project_id: projectId, title: `${run} pipe run`, status: 'Issued',
      issued_at: new Date().toISOString(), order_value: 10_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD',
      site_warehouse_id: site.id,
    }).select('id').single()).id;
    const boq = need('boq item', await svc.from('boq_items').insert({
      org_id: ORG_ID, project_id: projectId, item_code: `W-${sfx}`, description: 'Weld joints', unit: 'm', quantity: 100, rate: 5,
    }).select('id').single());
    ok('allocation', await svc.from('work_order_lines').insert({ org_id: ORG_ID, work_order_id: workOrderId, boq_item_id: boq.id, quantity: 100 }));
    const item = await makeItem(admin, sfx, 'CONS');
    itemId = item.id;
    ok('consumable flag', await svc.from('stock_items').update({ consumable: true }).eq('id', item.id));
    await postReceive(admin, site.id, item.id, '10');

    // 1. The project administrator starts today's report and enters the consumables used.
    await pa.signIn(page);
    await page.goto('/site-reports');
    await page.getByRole('button', { name: 'New report' }).first().click();
    await page.getByLabel('Project').selectOption({ label: `${run} project` });
    await page.getByLabel('Work order').selectOption({ label: `${run} pipe run` });
    await page.getByRole('button', { name: 'Start report' }).click();
    await expect(page).toHaveURL(/\/site-reports\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    const reportUrl = new URL(page.url()).pathname;
    await page.getByRole('button', { name: 'Add consumable' }).click();
    await page.getByLabel('Stock item').selectOption({ label: `${item.code} · ${item.name}` });
    await page.getByLabel(/^Quantity/).last().fill('2');
    // One contract item on the work order: the report takes it itself, so there is no "Used on contract item" choice to make.

    // 2. Submit with the paper form's photo, then the project manager validates it.
    await page.getByTestId('dsr-photo-input').setInputFiles({ name: 'paper-form.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByTestId('dsr-photos')).toContainText('paper-form.png', { timeout: 20_000 });
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByTestId('dsr-status')).toHaveAttribute('data-status', 'submitted', { timeout: 15_000 });

    await pm.signIn(page);
    await page.goto('/site-reports');
    const queue = page.getByTestId('dsr-queue');
    const link = queue.getByRole('link', { name: new RegExp(`${run} pipe run`) });
    await expect(link).toBeVisible({ timeout: 15_000 });
    await link.click();
    await page.getByRole('button', { name: 'Validate' }).click();
    await expect(page.getByTestId('dsr-status')).toHaveAttribute('data-status', 'validated', { timeout: 20_000 });

    // 3. Goal: the stock issue posts to the work order.
    const posted = page.getByTestId('dsr-stock-posted');
    await expect(posted).toBeVisible({ timeout: 20_000 });
    await expect(posted).toContainText('Issued to stock:');
    const issueNumber = /Issued to stock: (\S+)/.exec((await posted.textContent()) ?? '')?.[1] ?? '';
    expect(issueNumber).not.toBe('');
    const doc = need('stock document', await svc.from('stock_documents').select('id, work_order_id, warehouse_id').eq('number', issueNumber).single());
    expect(doc.work_order_id).toBe(workOrderId);
    expect(doc.warehouse_id).toBe(warehouseId);
    // The site store now holds 8 of the 10 (an append-only ledger line of -2).
    const moved = need('ledger', await svc.from('stock_ledger').select('qty_delta').eq('document_id', doc.id).eq('item_id', item.id).single());
    expect(Number(moved.qty_delta)).toBe(-2);

    // The report still shows the posting after a reload.
    await page.goto(reportUrl);
    await expect(page.getByTestId('dsr-stock-posted')).toContainText(issueNumber, { timeout: 20_000 });
  } finally {
    if (stockTouched) ok('org setting restore', await svc.from('organizations').update({ dsr_stock_issue: issueBefore, dsr_stock_issue_items: scopeBefore }).eq('id', ORG_ID));
    if (workOrderId) {
      // The posted ledger is append-only: remove exactly this run's rows as the owner, so the work order can go.
      sqlAsOwner(`
        delete from stock_ledger where document_id in (select id from stock_documents where work_order_id = '${workOrderId}');
        delete from stock_document_lines where document_id in (select id from stock_documents where work_order_id = '${workOrderId}');
        delete from dsr_stock_postings where issue_document_id in (select id from stock_documents where work_order_id = '${workOrderId}');
        delete from stock_documents where work_order_id = '${workOrderId}';
        delete from daily_site_reports where work_order_id = '${workOrderId}';
        delete from work_order_lines where work_order_id = '${workOrderId}';
        delete from boq_items where project_id = '${projectId}';
        delete from work_orders where id = '${workOrderId}';
      `);
    }
    if (projectId) await svc.from('projects').delete().eq('id', projectId);
    if (warehouseId) sqlAsOwner(`
      delete from stock_ledger where warehouse_id = '${warehouseId}';
      delete from stock_document_lines where document_id in (select id from stock_documents where warehouse_id = '${warehouseId}');
      delete from stock_documents where warehouse_id = '${warehouseId}';
      delete from stock_warehouses where id = '${warehouseId}';
    `);
    if (itemId) sqlAsOwner(`delete from stock_items where id = '${itemId}';`);
    await pm.cleanup();
    await pa.cleanup();
  }
});
