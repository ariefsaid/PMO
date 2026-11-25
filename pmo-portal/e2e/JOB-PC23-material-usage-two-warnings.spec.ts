// @e2e-isolation: self-isolated — its own organisation, role logins, project, work order, allowance, item, delivery location, approval chain and thresholds; deletes the organisation and its users in finally.
// JOB-PC23 (alert when material runs down): two usage thresholds are set. Goal: the engineer is warned when use passes the first
// threshold, and warned again at the second. The warnings are the request-time line warning (FR-MUT-002) and the in-app notification
// to the project's manager (FR-MUT-003); then the same two levels on ISSUED material (#2884, OD-R1125-4): the Engineer who is the work
// order's responsible person, and is NOT the project's manager, reads both warnings. The installed-usage banner is a separate rule (FR-UW-006).
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { sendForApproval } from './support/mrqJobFixture';
import { need, serviceClient } from './support/jobJourney';
import { createJobRoleUser, removeJobOrganization } from './support/jobRoleUser';

test.setTimeout(180_000);

test('JOB-PC23 material use passing the first threshold warns the engineer, and passing the second warns again', async ({ page }) => {
  const db = serviceClient('JOB-PC23');
  const must = need('JOB-PC23');
  const org = must('organisation', await db.from('organizations').insert({ name: `Usage alerts ${crypto.randomUUID()}`, default_currency: 'USD', built_in_roles_enabled: true }).select('id').single());
  const engineer = await createJobRoleUser(db, org.id, 'engineer');
  const manager = await createJobRoleUser(db, org.id, 'project_manager');
  const requester = await createJobRoleUser(db, org.id, 'material_coordinator');

  try {
    const project = must('project', await db.from('projects').insert({ org_id: org.id, name: 'Quay extension', status: 'Ongoing Project', currency: 'USD', project_manager_id: manager.id }).select('id').single());
    const wo = must('work order', await db.from('work_orders').insert({
      org_id: org.id, project_id: project.id, wo_number: 'WO-PC23', title: 'Quay slab', status: 'Issued', order_value: 20_000, responsible_person_id: engineer.id,
      issued_at: new Date().toISOString(), tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD',
    }).select('id').single());
    const unit = must('unit', await db.from('stock_units').insert({ org_id: org.id, code: 'bag', name: 'Bag', whole_only: true }).select('id').single());
    const item = must('item', await db.from('stock_items').insert({ org_id: org.id, code: 'CEM-PC23', name: 'Cement', unit_id: unit.id }).select('id').single());
    const boq = must('contract line', await db.from('boq_items').insert({ org_id: org.id, project_id: project.id, item_code: 'CEM', description: 'Cement', unit: 'bag', quantity: 100, rate: 5 }).select('id').single());
    must('allocation', await db.from('work_order_lines').insert({ org_id: org.id, work_order_id: wo.id, boq_item_id: boq.id, quantity: 100 }).select('id'));
    must('allowance', await db.from('boq_material_allowances').insert({ org_id: org.id, boq_item_id: boq.id, item_id: item.id, planned_quantity: 100 }).select('id'));
    const store = must('delivery location', await db.from('stock_warehouses').insert({ org_id: org.id, code: 'SITE-PC23', name: 'Site store', kind: 'site', project_id: project.id }).select('id').single());
    // The Admin sets the approval chain and the two usage thresholds.
    must('chain', await db.from('approval_chain_steps').insert({ org_id: org.id, position: 1, role: 'Project Manager', label: 'Plan check' }).select('id'));
    must('thresholds', await db.from('material_request_settings').upsert({ org_id: org.id, usage_warn_pct_1: 80, usage_warn_pct_2: 100, usage_installed_source: 'stock_issues' }).select('org_id'));

    // 1. Use reaches 85 of a plan of 100: the line warns at the first threshold and the project's manager is told.
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

    await manager.signIn(page);
    await page.getByRole('button', { name: /notifications/i }).click();
    const inbox = page.getByRole('list', { name: 'Notifications' });
    await expect(inbox.getByText(/has reached the 80% usage threshold/)).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press('Escape');

    // 2. Another request takes use to 105: the line warns at the second threshold and the manager is told again.
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

    await manager.signIn(page);
    await page.getByRole('button', { name: /notifications/i }).click();
    const both = page.getByRole('list', { name: 'Notifications' });
    await expect(both.getByText(/has reached the 100% usage threshold/)).toBeVisible({ timeout: 20_000 });
    await expect(both.getByText(/has reached the 80% usage threshold/)).toBeVisible();

    // 3. Stock is received into the site store and issued to the work order, by an Admin with a real login (the stock functions read the caller).
    const keeper = await createJobRoleUser(db, org.id, 'administrator');
    const email = `pc23-keeper-${crypto.randomUUID()}@example.test`;
    const password = `${crypto.randomUUID()}Aa1!`;
    must('keeper login', await db.auth.admin.updateUserById(keeper.id, { email, password }).then((r) => ({ data: r.data.user, error: r.error })));
    await db.from('profiles').update({ email }).eq('id', keeper.id).throwOnError();
    const stock = createClient(process.env.SUPABASE_URL as string, process.env.VITE_SUPABASE_ANON_KEY as string, { auth: { persistSession: false } });
    const signedIn = await stock.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw signedIn.error;
    const received = await stock.rpc('create_stock_document', { p_header: { kind: 'receive', warehouse_id: store.id }, p_lines: [{ item_id: item.id, quantity: '200', unit_cost: '5' }], p_post: true, p_client_request_id: crypto.randomUUID() });
    if (received.error) throw new Error(`JOB-PC23 receive: ${received.error.message}`);
    const issue = async (qty: number) => {
      const r = await stock.rpc('create_stock_document', { p_header: { kind: 'issue', warehouse_id: store.id, project_id: project.id, work_order_id: wo.id }, p_lines: [{ item_id: item.id, quantity: String(qty), boq_item_id: boq.id }], p_post: true, p_client_request_id: crypto.randomUUID() });
      if (r.error) throw new Error(`JOB-PC23 issue: ${r.error.message}`);
      // The issue is posted first and tied to its work order afterwards, as the stock screen does.
      const tied = await stock.rpc('set_cost_attribution', { p_source: 'stock_document', p_ids: [r.data as string], p_work_order_id: wo.id, p_discipline_id: null });
      if (tied.error) throw new Error(`JOB-PC23 attribution: ${tied.error.message}`);
    };
    await issue(85);
    await engineer.signIn(page);
    await page.goto('/dashboard');
    await page.getByRole('button', { name: /notifications/i }).click();
    const issued = page.getByRole('list', { name: 'Notifications' });
    await expect(issued.getByText(/has reached the 80% usage warning/)).toBeVisible({ timeout: 20_000 });
    await expect(issued.getByText(/has reached the 100% usage warning/)).toHaveCount(0);
    await page.keyboard.press('Escape');

    // 4. More is issued past the second level: the Engineer is warned again, and the first warning is still there once.
    await issue(20);
    await page.reload();
    await page.getByRole('button', { name: /notifications/i }).click();
    const issuedBoth = page.getByRole('list', { name: 'Notifications' });
    await expect(issuedBoth.getByText(/has reached the 100% usage warning/)).toBeVisible({ timeout: 20_000 });
    await expect(issuedBoth.getByText(/has reached the 80% usage warning/)).toHaveCount(1);
  } finally {
    removeJobOrganization(org.id);
    await manager.remove();
    await engineer.remove();
    await requester.remove();
  }
});
