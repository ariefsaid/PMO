// @e2e-isolation: self-isolated — disposable job logins, project, work order and plan; no organisation settings changed.
import { test, expect } from '@playwright/test';
import { cleanupAll, need, projectWithWorkOrders, runId, serviceClient } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(120_000);
for (const key of ['project_control_manager', 'planner']) {
  test(`JOB-SR ${key} sets a monthly target and edits a daily target on the work-order screen`, async ({ page }) => {
    const db = serviceClient('JOB-SR');
    const run = runId('SR');
    const actor = await roleJobUser(db, key, `${run}-${key}`);
    let project = ''; let workOrder = '';
    try {
      const fx = await projectWithWorkOrders(db, run, ['Target entry']);
      project = fx.projectId; workOrder = fx.workOrders[0].id;
      await actor.signIn(page);
      await page.goto(`/work-orders/${workOrder}`);
      const section = page.getByTestId('wo-page-revenue-plan');
      await section.getByRole('button', { name: 'Enter plan', exact: true }).click();
      const month = await page.locator('#wrp-month').inputValue();
      await page.locator('#wrp-amount').fill('1200');
      await page.getByRole('button', { name: 'Save plan', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(section.getByTestId('wo-revenue-plan-total')).toContainText('1,200');
      await section.getByRole('button', { name: 'Enter plan', exact: true }).click();
      await page.locator('#wrp-mode').selectOption('date');
      await page.locator('#wrp-date').fill(month);
      await page.locator('#wrp-amount').fill('75');
      await page.getByRole('button', { name: 'Save plan', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      const day = need('saved daily target', await db.from('work_order_revenue_plan').select('amount,source').eq('work_order_id',workOrder).eq('plan_date',month).single());
      expect(Number(day.amount)).toBe(75); expect(day.source).toBe('date');
      await page.reload();
      await expect(section.getByRole('button', { name: 'Enter plan', exact: true })).toBeVisible();
    } finally {
      await cleanupAll(db, [['work_order_revenue_plan','work_order_id',workOrder ? [workOrder] : []], ['work_orders','id',workOrder ? [workOrder] : []], ['projects','id',project ? [project] : []]]);
      await actor.cleanup();
    }
  });
}
