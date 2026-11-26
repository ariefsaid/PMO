// @e2e-isolation: self-isolated — own project-control-manager login, project, work order, contract line, asset with a hire rate and approved usage; deleted in afterEach.
// JOB-PC2 (project control): a page per work order. The page shows scope, costs by source, plan, billing claim, issue and open task of the work order.
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cleanupAll, cleanupEquipment, equipmentCost, need, ok, ORG_ID, projectWithWorkOrders, runId, serviceClient, type EquipmentCostFixture } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';
import { addIssueType, cleanSiteIssue } from './siteIssueFixture';
import { ENGINEER_ID, inDays } from './support/jobJourney';
import { openWorkOrderArea } from './support/workOrderArea';

test.setTimeout(120_000);

let admin: SupabaseClient;
let pcm: Awaited<ReturnType<typeof roleJobUser>> | undefined;
let projectId = ''; let woIds: string[] = []; let equipment: EquipmentCostFixture | undefined; let boqId = ''; let issueType = '';
test.afterEach(async () => {
  if (!admin) return;
  await cleanupEquipment(admin, equipment);
  await cleanSiteIssue(issueType);
  await cleanupAll(admin, [
    ['tasks', 'work_order_id', woIds],
    ['progress_claims', 'work_order_id', woIds],
    ['sales_invoices', 'work_order_id', woIds],
    ['work_order_plan_lines', 'work_order_id', woIds],
    ['work_order_lines', 'work_order_id', woIds],
    ['boq_items', 'id', boqId ? [boqId] : []],
    ['work_orders', 'id', woIds],
    ['projects', 'id', projectId ? [projectId] : []],
  ]);
  projectId = ''; woIds = []; equipment = undefined; boqId = ''; issueType = '';
  await pcm?.cleanup(); pcm = undefined;
});

test('JOB-PC2 a project control manager opens the work order page from the project and sees its scope and its costs', async ({ page }) => {
  admin = serviceClient('JOB-PC2');
  const run = runId('JOBPC2');
  pcm = await roleJobUser(admin, 'project_control_manager', run);
  const fx = await projectWithWorkOrders(admin, run, ['Pipe spool']);
  projectId = fx.projectId; woIds = fx.workOrders.map((w) => w.id);
  const wo = fx.workOrders[0];
  boqId = need('line', await admin.from('boq_items').insert({ org_id: ORG_ID, project_id: projectId, item_code: 'SPOOL', description: 'Spool fabrication', unit: 'ea', quantity: 20, rate: 100 }).select('id').single()).id;
  ok('allocation', await admin.from('work_order_lines').insert({ org_id: ORG_ID, work_order_id: wo.id, boq_item_id: boqId, quantity: 20 }));
  equipment = await equipmentCost(admin, run, projectId, 100, [{ woId: wo.id, day: '2026-11-10', hours: 3 }]);

  // The rest of what the work order owns: a plan, a claim, an issue and an open task.
  ok('plan', await admin.from('work_order_plan_lines').insert({ org_id: ORG_ID, project_id: projectId, work_order_id: wo.id, kind: 'direct_budget', value: 1234 }));
  // A claim is an invoice that also carries a progress_claims record under the same id.
  const claimId = crypto.randomUUID();
  ok('claim', await admin.from('sales_invoices').insert({ id: claimId, org_id: ORG_ID, project_id: projectId, work_order_id: wo.id, amount: 2500, currency: 'USD', tax_treatment: 'exclusive', tax_amount: 0, status: 'Unpaid', invoice_date: inDays(0), si_number: `SI-${run}` }));
  ok('claim record', await admin.from('progress_claims').insert({ id: claimId, org_id: ORG_ID, project_id: projectId, work_order_id: wo.id, kind: 'progress', currency: 'USD', gross_amount: 2500, created_by: pcm.id }));
  issueType = `${run} issue`;
  await addIssueType(issueType);
  ok('issue', await admin.from('incident_reports').insert({ org_id: ORG_ID, project_id: projectId, work_order_id: wo.id, incident_date: inDays(0), type: issueType, severity: 'Low', status: 'Open', action: `${run} fix it`, assignee_id: ENGINEER_ID }));
  const taskName = `${run} close the punch list`;
  ok('task', await admin.from('tasks').insert({ org_id: ORG_ID, project_id: projectId, work_order_id: wo.id, name: taskName, status: 'To Do' }));

  await pcm.signIn(page);
  await page.goto(`/projects/${projectId}/contract`);
  await page.getByTestId(`wo-page-link-${wo.id}`).click();
  await expect(page).toHaveURL(new RegExp(`/work-orders/${wo.id}$`));
  await expect(page.getByRole('heading', { level: 1 })).toContainText(wo.number);
  await expect(page.getByTestId(`scope-line-${boqId}`)).toContainText('Spool fabrication');
  await openWorkOrderArea(page, 'cost');
  await expect(page.getByTestId('cost-group-equipment_usage')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('cost-total-equipment_usage')).toContainText('$300');
  await expect(page.getByTestId('wo-page-pva-plan-direct')).toContainText('1,234', { timeout: 20_000 });
  await openWorkOrderArea(page, 'billing');
  await expect(page.getByTestId('billing-invoiced')).toContainText('2,500', { timeout: 20_000 });
  await expect(page.getByTestId('wo-billing-contract-link')).toHaveText('Claims and invoices');
  await openWorkOrderArea(page, 'issues');
  await expect(page.getByTestId('wo-issues')).toContainText(issueType, { timeout: 20_000 });
  await expect(page.getByTestId('wo-open-tasks')).toContainText(taskName, { timeout: 20_000 });
});
