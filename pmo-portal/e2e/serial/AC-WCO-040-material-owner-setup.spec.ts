// @e2e-isolation: serial — replaces the organisation close-out template and restores it in finally; all actor and project rows are owned.
import { test, expect } from '@playwright/test';
import { signIn } from '../helpers';
import { ORG_ID, need, ok, ownProject, runId, serviceClient } from '../support/jobFixtures';
import { roleJobUser } from '../support/roleJobUser';
import { userClient } from '../support/stockFixture';

test('AC-WCO-040 Admin assigns material close-out and the Material Coordinator attaches and completes it', async ({ page }) => {
  const svc = serviceClient('AC-WCO-040');
  const admin = await userClient('admin@acme.test');
  const before = need('template before', await admin.from('closeout_checklist_templates').select('name,required,target_days,owner_job_role').order('position'));
  const run = runId('material-close');
  const actor = await roleJobUser(svc, 'material_coordinator', run);
  let projectId = ''; let woId = ''; let docId = '';
  try {
    ok('initial template', await admin.rpc('set_closeout_checklist', { p_items: [{ name: run, required: true }] }));
    await signIn(page, 'admin@acme.test');
    await page.goto('/administration/projects');
    const editor = page.getByRole('region', { name: 'Close-out checklist', exact: true });
    await expect(editor.getByText('Without an owner job role, only an Admin, Finance, or the project manager can complete this item.')).toBeVisible();
    await editor.getByLabel('Owner job role').selectOption('material_coordinator');
    await editor.getByRole('button', { name: 'Save checklist', exact: true }).click();
    await expect(page.getByText('Close-out checklist saved', { exact: true })).toBeVisible();
    projectId = await ownProject(svc, run);
    woId = need('draft work order', await svc.from('work_orders').insert({ org_id: ORG_ID, project_id: projectId, title: run, status: 'Draft', order_value: 100, currency: 'USD', tax_treatment: 'exclusive', tax_amount: 0 }).select('id').single()).id;
    ok('issue snapshot', await svc.from('work_orders').update({ status: 'Issued', issued_at: new Date().toISOString(), wo_number: run }).eq('id', woId));
    docId = need('approved material report', await svc.from('project_documents').insert({ org_id: ORG_ID, project_id: projectId, category: 'Acceptance', title: run, status: 'Approved', author_id: actor.id, file_path: `${ORG_ID}/${projectId}/${crypto.randomUUID()}/report.pdf` }).select('id').single()).id;
    await actor.signIn(page);
    await page.goto(`/work-orders/${woId}`);
    await page.getByRole('combobox', { name: `Document for ${run}` }).selectOption(docId);
    await page.getByRole('button', { name: `Attach to ${run}`, exact: true }).click();
    await page.getByRole('button', { name: `Mark ${run} done`, exact: true }).click();
    await expect(page.getByTestId('closeout-summary')).toContainText('Every required item is done');
    await page.reload();
    await expect(page.getByTestId('closeout-summary')).toContainText('Every required item is done');
  } finally {
    ok('restore template', await admin.rpc('set_closeout_checklist', { p_items: before }));
    if (woId) ok('work order cleanup', await svc.from('work_orders').delete().eq('id', woId));
    if (docId) ok('document cleanup', await svc.from('project_documents').delete().eq('id', docId));
    if (projectId) ok('project cleanup', await svc.from('projects').delete().eq('id', projectId));
    await actor.cleanup();
  }
});
