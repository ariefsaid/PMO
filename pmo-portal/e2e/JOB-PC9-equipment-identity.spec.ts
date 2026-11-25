// @e2e-isolation: self-isolated — disposable tenant, Planner login, work order and approved equipment entry.
import { test, expect } from '@playwright/test';
import { serviceClient, need, orgToday } from './support/jobJourney';
import { createJobRoleUser, removeJobOrganization } from './support/jobRoleUser';

test.setTimeout(90000);
test('JOB-PC9 Planner identifies the machine allocated to its work order', async ({ page }) => {
  const db = serviceClient('JOB-PC9');
  const must = need('JOB-PC9');
  const org = must('organisation', await db.from('organizations').insert({ name: `Resources ${crypto.randomUUID()}`, built_in_roles_enabled: true }).select('id').single());
  const planner = await createJobRoleUser(db, org.id, 'planner');
  try {
    const project = must('project', await db.from('projects').insert({ org_id: org.id, name: 'Resource work', status: 'Ongoing Project' }).select('id').single());
    const wo = must('work order', await db.from('work_orders').insert({ org_id: org.id, project_id: project.id, title: 'Resource work order', status: 'Issued', order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0 }).select('id').single());
    const asset = must('asset', await db.from('equipment_assets').insert({ org_id: org.id, code: 'CR-1', name: 'Site crane', default_unit: 'days' }).select('id').single());
    must('approved equipment', await db.from('equipment_usage_entries').insert({ org_id: org.id, project_id: project.id, work_order_id: wo.id, author_id: planner.id, asset_id: asset.id, work_date: orgToday(), quantity: 1, unit: 'days', kind: 'work', status: 'Approved', approved_at: new Date().toISOString() }).select('id'));
    await planner.signIn(page);
    await page.goto(`/work-orders/${wo.id}`);
    const equipment = page.getByTestId('cost-group-equipment_usage');
    await expect(equipment).toContainText('CR-1 · Site crane');
    await expect(equipment).toContainText('1 days');
  } finally {
    removeJobOrganization(org.id);
    await planner.remove();
  }
});
