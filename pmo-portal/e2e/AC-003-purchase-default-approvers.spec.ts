// @e2e-isolation: self-isolated — owns the organisation, job logins, project, budget and purchase.
import { test, expect } from '@playwright/test';
import { need, ok, runId, serviceClient } from './support/jobFixtures';
import { createJobRoleUser, removeJobOrganization } from './support/jobRoleUser';

test.setTimeout(120_000);
const db = serviceClient('purchase default approvers');
for (const scenario of [
  { role: 'deputy_project_manager', type: 'Goods', ac: 'AC-003' },
  { role: 'procurement_manager', type: 'Service', ac: 'AC-004' },
]) {
  test(`${scenario.ac} ${scenario.role} approves the purchase routed to their default role`, async ({ page }) => {
    const tag = runId('default-approver');
    const orgId = crypto.randomUUID();
    let approver: Awaited<ReturnType<typeof createJobRoleUser>> | undefined;
    let requester: Awaited<ReturnType<typeof createJobRoleUser>> | undefined;
    try {
      ok('organisation', await db.from('organizations').insert({ id: orgId, name: tag, default_currency: 'USD', built_in_roles_enabled: true }));
      approver = await createJobRoleUser(db, orgId, scenario.role);
      requester = await createJobRoleUser(db, orgId, 'buyer');
      const project = need('project', await db.from('projects').insert({ org_id: orgId, name: tag, status: 'Ongoing Project', currency: 'USD', deputy_manager_id: scenario.type === 'Goods' ? approver.id : null }).select('id').single());
      const budget = need('budget', await db.from('budget_versions').insert({ org_id: orgId, project_id: project.id, name: tag, version: 1, status: 'Draft', currency: 'USD' }).select('id').single());
      ok('line', await db.from('budget_line_items').insert({ org_id: orgId, budget_version_id: budget.id, category: 'Materials', budgeted_amount: 1000 }));
      ok('activate', await db.from('budget_versions').update({ status: 'Active' }).eq('id', budget.id));
      const type = need('purchase type', await db.from('purchase_types').select('id').eq('org_id', orgId).eq('name', scenario.type).single());
      const purchase = need('request', await db.from('procurements').insert({ org_id: orgId, project_id: project.id, title: tag, status: 'Requested', requested_by_id: requester.id, total_value: 100, currency: 'USD', budget_category: 'Materials', purchase_type_id: type.id }).select('id').single());
      await approver.signIn(page);
      await page.goto(`/procurement/${purchase.id}`);
      await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
      await page.getByRole('button', { name: 'Approve', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Approve', exact: true }).click();
      await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Approved', { timeout: 15_000 });
    } finally {
      removeJobOrganization(orgId);
      for (const id of [approver?.id, requester?.id].filter((id): id is string => !!id)) ok('login cleanup', await db.auth.admin.deleteUser(id));
    }
  });
}
