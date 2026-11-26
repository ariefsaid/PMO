// @e2e-isolation: serial — configures and restores the org ordering roles; fixtures are otherwise isolated;  — owns its project, inspection, purchase and role logins; cleans up only those rows.
import { expect } from '@playwright/test';
import { buyerTest as test } from '../support/buyerOrdering';
import { moneyJobRole } from '../support/moneyJobRole';
import { serviceClient, projectWithWorkOrders, runId, need, ok, ORG_ID } from '../support/jobFixtures';
import { createProcurementFixture } from '../procurement-fixture';
import { recordOrderWithConfirm, signIn } from '../helpers';
import { openWorkOrderArea } from '../support/workOrderArea';

test('JOB-BQ9 Buyer finds the quality managers purchase, orders it and sees the inspection commitment', async ({ page }) => {
  const admin = serviceClient('inspection handoff');
  const buyer = await moneyJobRole('buyer');
  const quality = await moneyJobRole('quality_manager', 'Project Manager');
  const run = runId('inspection-handoff');
  const project = await projectWithWorkOrders(admin, run, ['Quality check']);
  let purchase: Awaited<ReturnType<typeof createProcurementFixture>> | undefined;
  let inspectionId = '';
  try {
    purchase = await createProcurementFixture({ status: 'Approved', title: run, projectId: project.projectId, workOrderId: project.workOrders[0].id, requestedBy: quality.id, withSupplier: true });
    inspectionId = need('inspection', await admin.from('third_party_inspections').insert({
      org_id: ORG_ID, project_id: project.projectId, work_order_id: project.workOrders[0].id,
      title: run, planned_date: '2026-11-24', required_for: ['billing'], status: 'purchase_raised',
      created_by: quality.id, procurement_id: purchase.id,
    }).select('id').single()).id;
    await buyer.login(page);
    await page.goto('/procurement');
    await page.getByRole('tab', { name: /^All/ }).click();
    await page.getByText(`${run} ${purchase.code}`, { exact: true }).click();
    await recordOrderWithConfirm(page);
    await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Ordered');
    await page.goto(`/work-orders/${project.workOrders[0].id}`);
    await openWorkOrderArea(page, 'checks');
    const card = page.getByTestId('inspection-' + inspectionId);
    await expect(card.getByRole('link')).toHaveAttribute('href', `/procurement/${purchase.id}`);
    // Admin records the supplier order amount on screen after the buyer places the order.
    // The native capture completes the numbered order stub with its explicit document price.
    await signIn(page, 'admin@acme.test');
    await page.goto(purchase.url);
    await page.getByRole('button', { name: 'Record another document' }).click();
    await page.getByRole('menuitem', { name: /^Purchase order$/i }).click();
    const orderForm = page.getByTestId('form-capture-purchase_order');
    await orderForm.getByTestId('purchase_order-status-select').selectOption('Issued');
    await orderForm.getByTestId('purchase_order-amount-input').fill('12000');
    await orderForm.getByRole('button', { name: 'Save Purchase Order', exact: true }).click();
    await expect(orderForm).toBeHidden();
    // Quality manager reads the cost after purchasing finishes its dependency.
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await quality.login(page);
    await page.goto(`/work-orders/${project.workOrders[0].id}`);
    await openWorkOrderArea(page, 'checks');
    await expect(page.getByTestId('inspection-' + inspectionId).getByTestId('inspection-cost')).toContainText(/12[,.]000.*committed/);
  } finally {
    if (inspectionId) ok('inspection', await admin.from('third_party_inspections').delete().eq('id', inspectionId));
    await purchase?.cleanup();
    ok('work orders', await admin.from('work_orders').delete().eq('project_id', project.projectId));
    ok('project', await admin.from('projects').delete().eq('id', project.projectId));
    await buyer.cleanup(); await quality.cleanup();
  }
});
