// @e2e-isolation: self-isolated — creates its own uniquely-named project, work order, discipline and expense claim each run, and deletes them afterwards; touches no shared seed row.
/**
 * AC-SCWO-013 — site cash and expense claims carry a work order (#2732): the one cross-stack journey. A Project Manager
 * files an expense claim on a project, names one of its work orders and a discipline on the same form, and the saved claim
 * shows both and carries them in the database (the row the work order's cost lines and plan versus actual read).
 * Goal oracle: the claim's own record, end to end.
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { signIn, requireServiceRoleKey } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const VITE_ENV = loadEnv('development', process.cwd(), 'VITE_');
const SUPABASE_URL = requireMatchingLocalSupabaseUrls(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_URL ?? VITE_ENV.VITE_SUPABASE_URL,
);

test.setTimeout(120_000);

let admin: SupabaseClient | undefined;
let projectId = '';
let workOrderId = '';
let disciplineId = '';
let tag = '';

test.beforeEach(async () => {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-SCWO-013 needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh, which exports it');
  admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  tag = `SCWO-013 ${Date.now()}`;
  const project = await admin.from('projects').insert({ org_id: ORG_ID, name: tag, status: 'Ongoing Project' }).select('id').single();
  if (project.error) throw new Error(`AC-SCWO-013 fixture project: ${project.error.message}`);
  projectId = project.data.id;
  const wo = await admin.from('work_orders')
    .insert({ org_id: ORG_ID, project_id: projectId, wo_number: `WO-${Date.now() % 100000}`, title: `${tag} scope`, status: 'Draft', order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0 })
    .select('id').single();
  if (wo.error) throw new Error(`AC-SCWO-013 fixture work order: ${wo.error.message}`);
  workOrderId = wo.data.id;
  const discipline = await admin.from('cost_disciplines').insert({ org_id: ORG_ID, code: `S${Date.now() % 100000}`, name: `${tag} Civil` }).select('id').single();
  if (discipline.error) throw new Error(`AC-SCWO-013 fixture discipline: ${discipline.error.message}`);
  disciplineId = discipline.data.id;
});

test.afterEach(async () => {
  if (!admin || !projectId) return;
  const fail = (step: string, e: { message: string } | null) => { if (e) throw new Error(`AC-SCWO-013 cleanup ${step}: ${e.message}`); };
  fail('claims', (await admin.from('expense_claims').delete().eq('project_id', projectId)).error);
  fail('work orders', (await admin.from('work_orders').delete().eq('id', workOrderId)).error);
  fail('discipline', (await admin.from('cost_disciplines').delete().eq('id', disciplineId)).error);
  fail('project', (await admin.from('projects').delete().eq('id', projectId)).error);
  projectId = '';
});

test('AC-SCWO-013 an expense claim names its work order and discipline on the same form and carries them', async ({ page }) => {
  await signIn(page, 'pm@acme.test');
  await page.goto('/expenses/new');
  await page.getByRole('textbox', { name: 'Title' }).fill(`${tag} cable ties`);
  await page.getByLabel('Project').selectOption({ label: tag });
  await page.getByLabel('Budget category').selectOption({ index: 1 });

  await page.getByRole('combobox', { name: 'Work order' }).click();
  await page.getByRole('option', { name: new RegExp(tag) }).click();
  await page.getByRole('combobox', { name: 'Discipline' }).click();
  await page.getByRole('option', { name: new RegExp(`${tag} Civil`) }).click();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page).toHaveURL(/\/expenses\/[0-9a-f-]{36}$/, { timeout: 15_000 });

  await expect(page.getByTestId('expense-work-order')).toContainText('WO-');
  await expect(page.getByTestId('expense-discipline')).toContainText(`${tag} Civil`);
  const row = await admin!.from('expense_claims').select('work_order_id, discipline_id').eq('project_id', projectId).single();
  expect(row.error).toBeNull();
  expect(row.data).toEqual({ work_order_id: workOrderId, discipline_id: disciplineId });
});
