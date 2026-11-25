// @e2e-isolation: self-isolated — its own organisation, role logins, project, work order, allowance, item, delivery location, approval chain and thresholds; deletes the organisation and its users in finally.
// JOB-PC23 (alert when material runs down): two usage thresholds are set. Goal: the engineer is warned when use passes the first
// threshold, and warned again at the second. The warnings are the request-time line warning (FR-MUT-002) and the in-app notification
// to the work order's engineer (FR-MUT-003); the installed-usage banner on the work order is a separate, single-threshold rule (FR-UW-006).
import { test, expect } from '@playwright/test';
import { sendForApproval } from './support/mrqJobFixture';
import { need, serviceClient } from './support/jobJourney';
import { createJobRoleUser, removeJobOrganization } from './support/jobRoleUser';

test.setTimeout(180_000);

test('JOB-PC23 material use passing the first threshold warns the engineer, and passing the second warns again', async ({ page }) => {
  const db = serviceClient('JOB-PC23');
  const must = need('JOB-PC23');
  const org = must('organisation', await db.from('organizations').insert({ name: `Usage alerts ${crypto.randomUUID()}`, default_currency: 'USD', built_in_roles_enabled: true }).select('id').single());
  const engineer = await createJobRoleUser(db, org.id, 'engineer');
  const requester = await createJobRoleUser(db, org.id, 'material_coordinator');

  try {
    const project = must('project', await db.from('projects').insert({ org_id: org.id, name: 'Quay extension', status: 'Ongoing Project', currency: 'USD', project_manager_id: engineer.id }).select('id').single());
    const wo = must('work order', await db.from('work_orders').insert({
      org_id: org.id, project_id: project.id, wo_number: 'WO-PC23', title: 'Quay slab', status: 'Issued', order_value: 20_000,
      issued_at: new Date().toISOString(), tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD',
    }).select('id').single());
    const unit = must('unit', await db.from('stock_units').insert({ org_id: org.id, code: 'bag', name: 'Bag', whole_only: true }).select('id').single());
    const item = must('item', await db.from('stock_items').insert({ org_id: org.id, code: 'CEM-PC23', name: 'Cement', unit_id: unit.id }).select('id').single());
    const boq = must('contract line', await db.from('boq_items').insert({ org_id: org.id, project_id: project.id, item_code: 'CEM', description: 'Cement', unit: 'bag', quantity: 100, rate: 5 }).select('id').single());
    must('allocation', await db.from('work_order_lines').insert({ org_id: org.id, work_order_id: wo.id, boq_item_id: boq.id, quantity: 100 }).select('id'));
    must('allowance', await db.from('boq_material_allowances').insert({ org_id: org.id, boq_item_id: boq.id, item_id: item.id, planned_quantity: 100 }).select('id'));
    must('delivery location', await db.from('stock_warehouses').insert({ org_id: org.id, code: 'SITE-PC23', name: 'Site store', kind: 'site', project_id: project.id }).select('id'));
    // The Admin sets the approval chain and the two usage thresholds.
    must('chain', await db.from('approval_chain_steps').insert({ org_id: org.id, position: 1, role: 'Project Manager', label: 'Plan check' }).select('id'));
    must('thresholds', await db.from('material_request_settings').upsert({ org_id: org.id, usage_warn_pct_1: 80, usage_warn_pct_2: 100 }).select('org_id'));

    // 1. Use reaches 85 of a plan of 100: the line warns at the first threshold and the engineer is told.
    await requester.signIn(page);
    await page.goto('/material-requests/new');
    await page.getByRole('combobox', { name: /^project/i }).click();
    await page.getByRole('option', { name: 'Quay extension' }).click();
    await page.getByRole('combobox', { name: /^work order/i }).click();
    await page.getByRole('option', { name: /WO-PC23/ }).first().click();
    await page.getByLabel(/^item/i).selectOption({ label: 'CEM-PC23 · Cement' });
    await page.getByLabel(/^quantity/i).fill('85');
    await expect(page.getByTestId('mrq-usage-warning')).toContainText('80%');
    await sendForApproval(page);
    await expect(page).toHaveURL(/\/material-requests\/[0-9a-f-]{36}$/, { timeout: 20_000 });

    await engineer.signIn(page);
    await page.getByRole('button', { name: /notifications/i }).click();
    const inbox = page.getByRole('list', { name: 'Notifications' });
    await expect(inbox.getByText(/has reached the 80% usage threshold/)).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press('Escape');

    // 2. Another request takes use to 105: the line warns at the second threshold and the engineer is told again.
    await requester.signIn(page);
    await page.goto('/material-requests/new');
    await page.getByRole('combobox', { name: /^project/i }).click();
    await page.getByRole('option', { name: 'Quay extension' }).click();
    await page.getByRole('combobox', { name: /^work order/i }).click();
    await page.getByRole('option', { name: /WO-PC23/ }).first().click();
    await page.getByLabel(/^item/i).selectOption({ label: 'CEM-PC23 · Cement' });
    await page.getByLabel(/^quantity/i).fill('20');
    await expect(page.getByTestId('mrq-usage-warning')).toContainText('100%');
    await sendForApproval(page);
    await expect(page).toHaveURL(/\/material-requests\/[0-9a-f-]{36}$/, { timeout: 20_000 });

    await engineer.signIn(page);
    await page.getByRole('button', { name: /notifications/i }).click();
    const both = page.getByRole('list', { name: 'Notifications' });
    await expect(both.getByText(/has reached the 100% usage threshold/)).toBeVisible({ timeout: 20_000 });
    await expect(both.getByText(/has reached the 80% usage threshold/)).toBeVisible();
  } finally {
    removeJobOrganization(org.id);
    await engineer.remove();
    await requester.remove();
  }
});
