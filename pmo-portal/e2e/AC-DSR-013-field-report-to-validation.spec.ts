// @e2e-isolation: self-isolated — creates its own uniquely-named project, work order and contract line each run and deletes them (and the report) afterwards; reads the seeded Project Manager and assigns them to its OWN project, touching no shared seed row.
/**
 * AC-DSR-013 / FR-WAIT-006 — daily site report (#1522): the one cross-stack journey. On a 390px phone the field
 * Engineer starts a report for today on a work order, enters progress, and submits it; Validate is never offered to
 * them, and the requester is told who the submitted report waits for. Finance (the QS stand-in) then finds it in the
 * validation queue with the paper form's photo attached.
 * Goal oracle: the report reaches the QS queue, submitted, with its photo, the author cannot validate it, and the
 * requester's who-next line names the assigned Project Manager with their real role while Finance/Admin stay the
 * true alternatives.
 * The photo ROW is written by the service role: CI runs with Storage disabled (ci.yml), so the upload itself is
 * proven at the unit layer (dailySiteReports.test.ts) and storage access at pgTAP (dsr_report.test.sql).
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { signIn, requireServiceRoleKey } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
// Seed contract (supabase/seed.sql §D): the seeded full Project Manager id. The journey reads that ONE row in
// beforeEach (org, role, status, built_in_role, name), refuses to run if a retargeted environment no longer holds
// that active full seat, and assigns it to its OWN project. The expected requester line is built from the row's own
// full_name, so a seed rename fails at the fixture rather than silently disagreeing with a second hardcoded copy.
const SEEDED_PM_ID = '00000000-0000-0000-0000-0000000000a2';
const VITE_ENV = loadEnv('development', process.cwd(), 'VITE_');
const SUPABASE_URL = requireMatchingLocalSupabaseUrls(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_URL ?? VITE_ENV.VITE_SUPABASE_URL,
);

test.setTimeout(120_000);
test.use({ viewport: { width: 390, height: 844 } });

let admin: SupabaseClient | undefined;
let projectId = '';
let tag = '';
let seededPmName = '';

test.beforeEach(async () => {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-DSR-013 needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh, which exports it');
  admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  tag = `DSR-013 ${Date.now()}`;
  const fail = (step: string, e: { message: string } | null) => { if (e) throw new Error(`AC-DSR-013 fixture ${step}: ${e.message}`); };
  // The named route needs the seeded ACTIVE FULL Project Manager of THIS organisation, and the expected sentence
  // is bound to that row's own full_name. A retargeted E2E org (or a seed change) must fail here loudly instead of
  // asserting a sentence the page cannot show.
  const pm = await admin.from('profiles').select('id, org_id, role, status, built_in_role, full_name').eq('id', SEEDED_PM_ID).single();
  fail('project manager read', pm.error);
  const pmRow = pm.data;
  if (!pmRow || pmRow.org_id !== ORG_ID || pmRow.role !== 'Project Manager' || pmRow.status !== 'active'
      || pmRow.built_in_role !== null || !pmRow.full_name?.trim()) {
    throw new Error(`AC-DSR-013 fixture: ${SEEDED_PM_ID} is not an active full Project Manager of organisation ${ORG_ID}`);
  }
  seededPmName = pmRow.full_name;
  const project = await admin.from('projects').insert({ org_id: ORG_ID, name: tag, status: 'Ongoing Project', project_manager_id: SEEDED_PM_ID }).select('id').single();
  fail('project', project.error);
  projectId = project.data!.id;
  const wo = await admin.from('work_orders').insert({
    org_id: ORG_ID, project_id: projectId, title: `${tag} pipe run`, status: 'Issued', order_value: 10000, tax_treatment: 'exclusive', tax_amount: 0,
  }).select('id').single();
  fail('work order', wo.error);
  const boq = await admin.from('boq_items').insert({
    org_id: ORG_ID, project_id: projectId, item_code: 'W-1', description: 'Weld joints', unit: 'm', quantity: 100, rate: 5,
  }).select('id').single();
  fail('contract line', boq.error);
  fail('allocation', (await admin.from('work_order_lines').insert({ org_id: ORG_ID, work_order_id: wo.data!.id, boq_item_id: boq.data!.id, quantity: 100 })).error);
});

test.afterEach(async () => {
  if (!admin || !projectId) return;
  const fail = (step: string, e: { message: string } | null) => { if (e) throw new Error(`AC-DSR-013 cleanup ${step}: ${e.message}`); };
  // Report children (lines, photos, history) go by ON DELETE CASCADE.
  fail('reports', (await admin.from('daily_site_reports').delete().eq('project_id', projectId)).error);
  const wos = await admin.from('work_orders').select('id').eq('project_id', projectId);
  const ids = (wos.data ?? []).map((w: { id: string }) => w.id);
  if (ids.length) fail('allocations', (await admin.from('work_order_lines').delete().in('work_order_id', ids)).error);
  fail('contract lines', (await admin.from('boq_items').delete().eq('project_id', projectId)).error);
  fail('work orders', (await admin.from('work_orders').delete().eq('project_id', projectId)).error);
  fail('project', (await admin.from('projects').delete().eq('id', projectId)).error);
  projectId = '';
});

test('AC-DSR-013 / FR-WAIT-006 a phone-entered field report reaches the QS queue with its photo, its author cannot validate it, and its requester is told the assigned PM waits', async ({ page }) => {
  await signIn(page, 'engineer@acme.test');
  await page.goto('/site-reports');
  await page.getByRole('button', { name: 'New report' }).first().click();
  await page.getByLabel('Project').selectOption({ label: tag });
  await page.getByLabel('Work order').selectOption({ label: `${tag} pipe run` });
  await page.getByRole('button', { name: 'Start report' }).click();
  await expect(page).toHaveURL(/\/site-reports\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  const reportId = page.url().split('/').pop()!;

  await page.getByRole('button', { name: 'Add progress' }).click();
  await page.getByLabel('Contract item').selectOption({ label: 'W-1 · Weld joints' });
  await page.getByLabel(/^Quantity/).fill('12.5');
  // The photo of the paper form (see header: the row stands in for the upload Storage-less CI cannot make).
  const photo = await admin!.from('dsr_photos').insert({ org_id: ORG_ID, report_id: reportId, kind: 'paper_form', file_path: `${ORG_ID}/${reportId}/00000000-0000-4000-8000-000000000013/form.jpg` });
  if (photo.error) throw new Error(`AC-DSR-013 photo row: ${photo.error.message}`);
  // A report without its photo is not sent. The page learns of the photo the way it does after a real upload: a save reads the report again.
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByTestId('dsr-author-needs-photo')).toHaveCount(0, { timeout: 15_000 });
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByTestId('dsr-status')).toHaveAttribute('data-status', 'submitted', { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Validate' })).toHaveCount(0);
  // FR-WAIT-006: the requester is told who the submitted report waits for, from the server-computed route: the
  // assigned PM is named with the database's own role, and Finance/Admin remain the true role-level alternatives.
  // The name comes from the seeded profile row read in beforeEach, never a second hardcoded copy.
  await expect(page.getByTestId('dsr-waiting-for')).toHaveText(
    `Waiting for ${seededPmName}, Project Manager or Finance or Admin`,
    { timeout: 15_000 },
  );

  await signIn(page, 'finance@acme.test');
  await page.goto('/site-reports');
  const queue = page.getByTestId('dsr-queue');
  await expect(queue.getByRole('link', { name: new RegExp(`${tag} pipe run`) })).toBeVisible({ timeout: 15_000 });
  await queue.getByRole('link', { name: new RegExp(`${tag} pipe run`) }).click();
  await expect(page.getByTestId('dsr-photos')).toContainText('form.jpg');
  await expect(page.getByTestId('dsr-progress')).toContainText('12.5');
  await expect(page.getByRole('button', { name: 'Validate' })).toBeEnabled();
});
