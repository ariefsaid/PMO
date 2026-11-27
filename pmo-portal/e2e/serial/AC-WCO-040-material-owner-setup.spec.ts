// @e2e-isolation: serial — replaces the organisation close-out template and restores it in finally; all actor and project rows are owned.
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { signIn } from '../helpers';
import { createDocument, documentRow, issueDocument, showRegister } from '../document-file-upload.helpers';
import { ORG_ID, need, ok, ownProject, runId, serviceClient } from '../support/jobFixtures';
import { roleJobUser } from '../support/roleJobUser';
import { userClient } from '../support/stockFixture';
import { openRowUpdate, openWorkOrderArea } from '../support/workOrderArea';

const PDF_FIXTURE = fileURLToPath(new URL('../fixtures/tiny-upload.pdf', import.meta.url));

test.setTimeout(120_000);

test('AC-WCO-040 Admin assigns material close-out and the Material Coordinator attaches and completes it', async ({ page }) => {
  const svc = serviceClient('AC-WCO-040');
  const admin = await userClient('admin@acme.test');
  const pm = await userClient('pm@acme.test');
  const before = need('template before', await admin.from('closeout_checklist_templates').select('name,required,target_days,owner_job_role').order('position'));
  const run = runId('material-close');
  const actor = await roleJobUser(svc, 'material_coordinator', run);
  let projectId = ''; let woId = ''; let docId = ''; let docPath = '';
  try {
    ok('initial template', await admin.rpc('set_closeout_checklist', { p_items: [{ name: run, required: true }] }));
    await signIn(page, 'admin@acme.test');
    await page.goto('/administration/projects');
    const editor = page.getByRole('region', { name: 'Close-out checklist', exact: true });
    await expect(editor.getByText('Without an owner job role, only an Admin, Finance, or the project manager can complete this item.')).toBeVisible();
    await editor.getByLabel('Owner job role').selectOption('material_coordinator');
    await editor.getByRole('button', { name: 'Save checklist', exact: true }).click();
    await expect(page.getByText('Close-out checklist saved', { exact: true })).toBeVisible();
    projectId = await ownProject(svc, run, need('manager', await svc.from('profiles').select('id').eq('email', 'pm@acme.test').single()).id);
    woId = need('draft work order', await svc.from('work_orders').insert({ org_id: ORG_ID, project_id: projectId, title: run, status: 'Draft', order_value: 100, currency: 'USD', tax_treatment: 'exclusive', tax_amount: 0 }).select('id').single()).id;
    ok('issue snapshot', await svc.from('work_orders').update({ status: 'Issued', issued_at: new Date().toISOString(), wo_number: run }).eq('id', woId));

    // Upload a real PDF through the project documents screen so the evidence binding rule is satisfied naturally, then issue and approve it.
    await page.goto(`/projects/${projectId}`);
    await page.getByRole('tab', { name: 'Documents' }).click();
    await expect(page.getByTestId('liststate-loading')).toHaveCount(0, { timeout: 20_000 });
    await showRegister(page);
    const row = await createDocument(page, { title: run, code: `MAT-${run.slice(-6)}`, category: 'Report' });
    const dismissNotification = page.getByRole('button', { name: 'Dismiss notification' });
    if (await dismissNotification.isVisible()) await dismissNotification.click();
    await row.getByLabel(`View ${run}`).click();
    const drawer = page.getByRole('dialog', { name: run });
    await expect(drawer).toBeVisible();
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      drawer.getByLabel(`Upload file for ${run}`).click(),
    ]);
    await chooser.setFiles(PDF_FIXTURE);
    await expect(row.getByText('tiny-upload.pdf')).toBeVisible({ timeout: 15_000 });
    await drawer.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(drawer).not.toBeVisible({ timeout: 10_000 });
    await issueDocument(page, documentRow(page, run));
    await expect(documentRow(page, run).getByText('Issued')).toBeVisible({ timeout: 15_000 });
    const uploaded = need('uploaded document', await svc.from('project_documents').select('id, file_path').eq('project_id', projectId).eq('title', run).single());
    docId = uploaded.id as string;
    docPath = (uploaded.file_path as string | null) ?? '';
    ok('approve document', await pm.rpc('transition_document_status', { p_doc_id: docId, p_to: 'Approved' }));

    await actor.signIn(page);
    await page.goto(`/work-orders/${woId}`);
    await openWorkOrderArea(page, 'checks');
    await openRowUpdate(page, run);
    await page.getByRole('combobox', { name: 'Project documents', exact: true }).selectOption(docId);
    await page.getByRole('button', { name: `Attach to ${run}`, exact: true }).click();
    await page.getByRole('button', { name: `Mark ${run} done`, exact: true }).click();
    await expect(page.getByTestId('closeout-summary')).toContainText('Every required item is done');
    await page.reload();
    await expect(page.getByTestId('closeout-summary')).toContainText('Every required item is done');
  } finally {
    ok('restore template', await admin.rpc('set_closeout_checklist', { p_items: before }));
    if (woId) ok('work order cleanup', await svc.from('work_orders').delete().eq('id', woId));
    if (docPath) await svc.storage.from('project-documents').remove([docPath]);
    if (docId) ok('document cleanup', await svc.from('project_documents').delete().eq('id', docId));
    if (projectId) ok('project cleanup', await svc.from('projects').delete().eq('id', projectId));
    await actor.cleanup();
  }
});
