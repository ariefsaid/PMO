// @e2e-isolation: self-isolated — owns its client, project, work order, two categories and two documents; deletes them in afterEach.
/**
 * JOB-BQ8 (quality lane): documents visible by role. A category the Admin hid from the Quality Inspector job role keeps its
 * document out of the work order's Documents section, while a document in a category the role may see still shows there.
 */
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ORG_ID, need, ok, runId, serviceClient, sqlAsOwner } from './support/jobFixtures';
import { orgToday } from './support/jobJourney';
import { createJobRoleUser } from './support/jobRoleUser';
import { openWorkOrderArea } from './support/workOrderArea';

test.setTimeout(180_000);

let admin: SupabaseClient | undefined;
let projectId = '';
let workOrderId = '';
let companyId = '';
let hiddenCategoryId = '';
let openCategoryId = '';
let hiddenDocId = '';
let openDocId = '';
let run = '';

test.beforeEach(async () => {
  admin = serviceClient('JOB-BQ8');
  const db = admin;
  run = runId('bq8');
  const finance = need('finance profile', await db.from('profiles').select('id').eq('org_id', ORG_ID).eq('email', 'finance@acme.test').single());
  companyId = need('client', await db.from('companies').insert({ org_id: ORG_ID, name: `${run} client`, type: 'Client' }).select('id').single()).id as string;
  projectId = need('project', await db.from('projects').insert({
    org_id: ORG_ID, name: run, status: 'Ongoing Project', currency: 'USD', client_id: companyId, contract_value: 100_000,
    tax_treatment: 'exclusive', tax_amount: 0, tax_rate: 0, tax_base_numerator: 1, tax_base_denominator: 1,
  }).select('id').single()).id as string;
  workOrderId = crypto.randomUUID();
  ok('work order', await db.from('work_orders').insert({
    id: workOrderId, org_id: ORG_ID, project_id: projectId, title: `${run} order`, wo_number: `WO-${run}`, status: 'Issued',
    issued_at: new Date().toISOString(), order_value: 100_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD',
  }));
  // One category hidden from the Quality Inspector, one open to the Engineer access level the role sits on.
  hiddenCategoryId = need('hidden category', await db.from('document_categories').insert({ org_id: ORG_ID, name: `${run} commercial`, hidden_job_roles: ['quality_inspector'] }).select('id').single()).id as string;
  openCategoryId = need('open category', await db.from('document_categories').insert({ org_id: ORG_ID, name: `${run} open` }).select('id').single()).id as string;
  for (const [categoryId, role] of [[hiddenCategoryId, 'Engineer'], [hiddenCategoryId, 'Admin'], [openCategoryId, 'Engineer'], [openCategoryId, 'Admin']] as const) {
    ok('category role', await db.from('document_category_roles').insert({ category_id: categoryId, org_id: ORG_ID, role }));
  }
  const newDoc = async (title: string, categoryId: string) => {
    const id = crypto.randomUUID();
    return need('document', await db.from('project_documents').insert({
      id, org_id: ORG_ID, project_id: projectId, category_id: categoryId, category: '', title, revision: 'A', status: 'Issued',
      file_path: `${ORG_ID}/${projectId}/${id}/report.pdf`,
    }).select('id').single()).id as string;
  };
  hiddenDocId = await newDoc(`${run} commercial report`, hiddenCategoryId);
  openDocId = await newDoc(`${run} quality report`, openCategoryId);
  // Both documents are attached to this work order's BASTs — which is how a work order's Documents section finds them.
  for (const [i, documentId] of [hiddenDocId, openDocId].entries()) {
    ok('acceptance', await db.from('work_order_acceptances').insert({
      org_id: ORG_ID, project_id: projectId, work_order_id: workOrderId, acceptance_date: orgToday(),
      is_final: false, status: 'Draft', prepared_by: finance.id, document_id: documentId, note: `stage ${i + 1}`,
    }));
  }
});

test.afterEach(async () => {
  if (!admin) return;
  const fail = (step: string, e: { message: string } | null) => { if (e) throw new Error(`JOB-BQ8 cleanup ${step}: ${e.message}`); };
  if (workOrderId) {
    // Acceptances are managed by their RPC (a delete is refused for every client): this run's rows go as the database owner.
    sqlAsOwner(`delete from public.work_order_acceptance_lines where acceptance_id in (select id from public.work_order_acceptances where work_order_id = '${workOrderId}'); delete from public.work_order_acceptances where work_order_id = '${workOrderId}';`);
    fail('work order', (await admin.from('work_orders').delete().eq('id', workOrderId)).error);
  }
  if (projectId) fail('documents', (await admin.from('project_documents').delete().eq('project_id', projectId)).error);
  if (projectId) fail('project', (await admin.from('projects').delete().eq('id', projectId)).error);
  for (const id of [hiddenCategoryId, openCategoryId]) if (id) fail('category', (await admin.from('document_categories').delete().eq('id', id)).error);
  if (companyId) fail('client', (await admin.from('companies').delete().eq('id', companyId)).error);
});

test('JOB-BQ8 a quality inspector opens a work order and does not see the category hidden from the quality role', async ({ page }) => {
  const db = admin as SupabaseClient;
  const quality = await createJobRoleUser(db, ORG_ID, 'quality_inspector');
  try {
    await quality.signIn(page);
    await page.goto(`/work-orders/${workOrderId}`);
    await openWorkOrderArea(page, 'documents');
    const documents = page.getByTestId('wo-documents');
    await expect(documents.getByText(`${run} quality report`)).toBeVisible({ timeout: 15_000 });
    await expect(documents.getByText(`${run} commercial report`)).toHaveCount(0);
    await expect(page.getByText(`${run} commercial`)).toHaveCount(0);
  } finally {
    await quality.remove();
  }
});
