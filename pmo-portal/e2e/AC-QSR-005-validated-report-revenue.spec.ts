// @e2e-isolation: self-isolated — owns a project, report, contract line and QS login; never changes shared settings or roles.
import { test, expect } from '@playwright/test';
import { moneyJobRole } from './support/moneyJobRole';
import { serviceClient, need, ok, ORG_ID, PM_ID, projectWithWorkOrders, cleanupAll, runId } from './support/jobFixtures';

let worker: Awaited<ReturnType<typeof moneyJobRole>>;
const db = serviceClient('QS report revenue');
let projectId = '';
let woId = '';
let reportId = '';
let tag = '';

test.beforeEach(async () => {
  worker = await moneyJobRole('quantity_surveyor');
  tag = runId('qs-revenue');
  const fixture = await projectWithWorkOrders(db, tag, ['priced progress']);
  projectId = fixture.projectId;
  woId = fixture.workOrders[0].id;
  const boq = need('contract item', await db.from('boq_items').insert({ org_id: ORG_ID, project_id: projectId, item_code: tag, description: 'Measured pipe', unit: 'm', quantity: 100, rate: 5 }).select('id').single());
  const line = need('work order line', await db.from('work_order_lines').insert({ org_id: ORG_ID, work_order_id: woId, boq_item_id: boq.id, quantity: 100 }).select('id').single());
  const report = need('validated report', await db.from('daily_site_reports').insert({ org_id: ORG_ID, project_id: projectId, work_order_id: woId, work_date: '2026-11-20', status: 'validated', author_id: worker.id, validated_by: PM_ID, validated_at: new Date().toISOString() }).select('id').single());
  reportId = report.id;
  ok('priced progress', await db.from('dsr_progress_lines').insert({ org_id: ORG_ID, report_id: reportId, position: 1, work_order_line_id: line.id, quantity: 10, unit: 'm', frozen_rate: 5, frozen_rate_source: 'contract', frozen_amount: 50, frozen_at: new Date().toISOString() }));
});

test.afterEach(async () => {
  await cleanupAll(db, [
    ['daily_site_reports', 'project_id', [projectId]],
    ['work_order_lines', 'work_order_id', [woId]],
    ['boq_items', 'project_id', [projectId]],
    ['work_orders', 'id', [woId]],
    ['projects', 'id', [projectId]],
  ]);
  await worker?.cleanup();
});

test('AC-QSR-005 Quantity Surveyor reads quantity times frozen rate on the validated daily report', async ({ page }) => {
  await worker.login(page);
  await page.goto('/site-reports');
  await page.getByRole('link').filter({ hasText: tag }).first().click();
  await expect(page).toHaveURL(new RegExp(`/site-reports/${reportId}$`));
  await expect(page.getByTestId('dsr-total')).toContainText('50.00');
  await expect(page.getByText('Validated to date', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Validate', exact: true })).toHaveCount(0);
});
