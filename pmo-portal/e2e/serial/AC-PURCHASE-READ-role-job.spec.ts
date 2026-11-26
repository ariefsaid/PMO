// @e2e-isolation: serial — Admin enables the organisation's job-role catalogue, then restores its previous setting.
import { test, expect } from '@playwright/test';
import { moneyJobRole } from '../support/moneyJobRole';
import { serviceClient, projectWithWorkOrders, runId, need, ok, ORG_ID } from '../support/jobFixtures';
import { inDays, orgToday } from '../support/jobJourney';
import { userClient } from '../support/stockFixture';
import { createProcurementFixture } from '../procurement-fixture';

test.setTimeout(180_000);
let previouslyEnabled: boolean;
test.beforeEach(async () => {
  const service = serviceClient('job-role setup');
  previouslyEnabled = need('role setting', await service.from('organizations').select('built_in_roles_enabled').eq('id', ORG_ID).single()).built_in_roles_enabled;
  if (!previouslyEnabled) ok('Admin enables catalogue', await (await userClient('admin@acme.test')).rpc('set_built_in_roles_enabled', { p_enabled: true }));
});
test.afterEach(async () => {
  if (!previouslyEnabled) ok('Admin restores catalogue', await (await userClient('admin@acme.test')).rpc('set_built_in_roles_enabled', { p_enabled: false }));
});

test('AC-PURCHASE-READ Procurement Manager marks a supplier at risk and sees that status on another manager’s order', async ({ page }) => {
  const service = serviceClient('supplier setup');
  const role = await moneyJobRole('procurement_manager', 'Project Manager');
  const run = runId('supplier-read');
  const setup = await projectWithWorkOrders(service, run, ['Supply']);
  const vendor = need('Admin registers supplier', await service.from('companies').insert({ org_id: ORG_ID, name: run, type: 'Vendor' }).select('id').single());
  const purchase = await createProcurementFixture({ title: run, status: 'Ordered', projectId: setup.projectId });
  const oldBillCase = await createProcurementFixture({ title: `${run} payable`, status: 'Received', projectId: setup.projectId });
  try {
    for (const id of [purchase.id, oldBillCase.id]) ok('set supplier', await service.from('procurements').update({ vendor_id: vendor.id }).eq('id', id));
    ok('Admin prepares old payable', await service.from('procurement_invoices').insert({ org_id: ORG_ID, procurement_id: oldBillCase.id, invoice_date: inDays(-100), status: 'Received', amount: 100, currency: 'USD', tax_treatment: 'exclusive', tax_amount: 0 }));
    const po = need('Admin records other manager order', await (await userClient('admin@acme.test')).rpc('create_purchase_order', { p_procurement_id: purchase.id, p_reference_number: null, p_status: 'Issued', p_date: orgToday(), p_amount: 100 }));
    await role.login(page);
    await page.goto(`/companies/${vendor.id}`);
    await page.getByTestId('supply-risk-set-suggested').click();
    await page.getByLabel(/Reason|Alasan/).fill('Payment is overdue and supply needs attention');
    await page.getByRole('button', { name: /Save status|Simpan status/ }).click();
    await expect(page.getByTestId('supply-risk-current')).toContainText(/At risk|Berisiko/);
    await page.goto(purchase.url);
    await expect(page.getByTestId('supply-risk-purchase-warning')).toContainText(run);
    await expect(page.getByTestId('supply-risk-purchase-warning')).toContainText(/at risk|berisiko/i);
    await expect(page.getByText(po.po_number, { exact: true })).toBeVisible();
    await expect(page.getByTestId('procurement-no-access')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /edit|approve|record another|raise order/i })).toHaveCount(0);
  } finally {
    ok('remove own invoice', await service.from('procurement_invoices').delete().eq('procurement_id', oldBillCase.id));
    await oldBillCase.cleanup();
    await purchase.cleanup();
    ok('remove own work orders', await service.from('work_orders').delete().eq('project_id', setup.projectId));
    ok('remove own project', await service.from('projects').delete().eq('id', setup.projectId));
    ok('remove own vendor', await service.from('companies').delete().eq('id', vendor.id));
    await role.cleanup();
  }
});
