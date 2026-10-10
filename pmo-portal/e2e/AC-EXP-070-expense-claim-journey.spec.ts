// @e2e-isolation: self-isolated — creates its own uniquely-named project, Active budget, project-approver row and expense claim each run, and deletes them afterwards; touches no shared seed row.
/**
 * AC-EXP-070 — expense claims (#775): the one cross-stack journey. A field Engineer files a Special-expenses claim on
 * a budgeted project; the project's named approver (the PM seed user) approves it from the record; Finance pays it;
 * the Engineer sees it Paid. Goal oracle: the record's status, end to end, by the people who act on it.
 * No receipt upload: CI runs with Storage disabled (ci.yml), so receipts are proven at the unit layer (AC-EXP-066).
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { signIn, requireServiceRoleKey } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const PM_ID = '00000000-0000-0000-0000-0000000000a2'; // the named project approver
const VITE_ENV = loadEnv('development', process.cwd(), 'VITE_');
const SUPABASE_URL = requireMatchingLocalSupabaseUrls(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_URL ?? VITE_ENV.VITE_SUPABASE_URL,
);

test.setTimeout(120_000);

let admin: SupabaseClient | undefined;
let projectId = '';
let tag = '';

test.beforeEach(async () => {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-EXP-070 needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh, which exports it');
  admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  tag = `EXP-070 ${Date.now()}`;
  const project = await admin.from('projects').insert({ org_id: ORG_ID, name: tag, status: 'Ongoing Project' }).select('id').single();
  if (project.error) throw new Error(`AC-EXP-070 fixture project: ${project.error.message}`);
  projectId = project.data.id;
  // budget_line_items_draft_guard: lines land only on a Draft version — Draft → line → Active.
  const version = await admin.from('budget_versions')
    .insert({ org_id: ORG_ID, project_id: projectId, name: tag, version: 1, status: 'Draft' }).select('id').single();
  if (version.error) throw new Error(`AC-EXP-070 fixture budget version: ${version.error.message}`);
  const line = await admin.from('budget_line_items')
    .insert({ org_id: ORG_ID, budget_version_id: version.data.id, category: 'Special expenses', budgeted_amount: 5_000_000 });
  if (line.error) throw new Error(`AC-EXP-070 fixture budget line: ${line.error.message}`);
  const activate = await admin.from('budget_versions').update({ status: 'Active' }).eq('id', version.data.id);
  if (activate.error) throw new Error(`AC-EXP-070 fixture budget activate: ${activate.error.message}`);
  const approver = await admin.from('spend_approvers').insert({ org_id: ORG_ID, project_id: projectId, profile_id: PM_ID });
  if (approver.error) throw new Error(`AC-EXP-070 fixture approver: ${approver.error.message}`);
});

test.afterEach(async () => {
  if (!admin || !projectId) return;
  const fail = (step: string, e: { message: string } | null) => { if (e) throw new Error(`AC-EXP-070 cleanup ${step}: ${e.message}`); };
  // Lines and receipt rows go by ON DELETE CASCADE.
  fail('claims', (await admin.from('expense_claims').delete().eq('project_id', projectId)).error);
  fail('approvers', (await admin.from('spend_approvers').delete().eq('project_id', projectId)).error);
  fail('versions', (await admin.from('budget_versions').delete().eq('project_id', projectId)).error);
  fail('project', (await admin.from('projects').delete().eq('id', projectId)).error);
  projectId = '';
});

test('AC-EXP-070 a field claim is filed, approved by the project approver, paid by Finance and seen as paid', async ({ page }) => {
  await signIn(page, 'engineer@acme.test');
  await page.goto('/expenses');
  await page.getByRole('button', { name: 'New claim' }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel(/Title/).fill(`${tag} site visit`);
  await form.getByLabel('Project').selectOption({ label: tag });
  await form.getByLabel('Budget category').selectOption({ label: 'Special expenses' });
  await form.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/expenses\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  const claimUrl = page.url();

  await page.getByRole('button', { name: 'Add line' }).click();
  const lineForm = page.getByRole('dialog');
  await lineForm.getByLabel(/Date/).fill('2026-10-01');
  await lineForm.getByLabel(/Description/).fill('Taxi to site');
  await lineForm.getByLabel(/Amount/).fill('750000');
  await lineForm.getByRole('button', { name: 'Add line' }).click();
  await expect(page.getByTestId('lines-total')).toContainText('750');
  await page.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(page.getByTestId('expense-status')).toHaveAttribute('data-status', 'Submitted', { timeout: 15_000 });

  await signIn(page, 'pm@acme.test');
  await page.goto(claimUrl);
  await page.getByRole('button', { name: /^(Approve|Setujui)$/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^(Approve|Setujui)$/ }).click();
  await expect(page.getByTestId('expense-status')).toHaveAttribute('data-status', 'Approved', { timeout: 15_000 });

  await signIn(page, 'finance@acme.test');
  await page.goto(claimUrl);
  await page.getByRole('button', { name: 'Mark paid' }).click();
  const pay = page.getByRole('dialog');
  await pay.getByLabel('Payment reference (optional)').fill(`TRF-${Date.now()}`);
  await pay.getByRole('button', { name: 'Mark paid', exact: true }).click();
  await expect(page.getByTestId('expense-status')).toHaveAttribute('data-status', 'Paid', { timeout: 15_000 });

  await signIn(page, 'engineer@acme.test');
  await page.goto(claimUrl);
  await expect(page.getByTestId('expense-status')).toHaveAttribute('data-status', 'Paid', { timeout: 15_000 });
});
