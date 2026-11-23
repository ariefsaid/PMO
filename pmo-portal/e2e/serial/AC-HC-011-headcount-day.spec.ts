// @e2e-isolation: serial - creates a labour class and a class rate for it and reads the seed org's classes list; self-contained rows are removed in afterEach.
/**
 * AC-HC-011 a daily head count of people with no name on the roster (docs/specs/guard-headcount.spec.md). The crew's
 * Foreman (the seeded Engineer, the crew's field controller) enters a number for a labour class on the crew's attendance
 * day; the line waits for approval; the Project Manager, who entered none of it, approves it on the same page.
 * Goal oracle: the line is approved in the database by a different person than the one who entered it, and the page
 * says so. Its cost (number x the class's daily rate) is proven where the money is read, by supabase/tests/1722_headcount_cost.test.sql.
 * ISOLATION: every row is per run with a unique name; headcount_days, rates, class, roster and crew are removed in afterEach.
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { signIn, requireServiceRoleKey } from '../helpers';
import { requireMatchingLocalSupabaseUrls } from '../../src/lib/testing/localSupabaseUrl';

const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const PM_ID = '00000000-0000-0000-0000-0000000000a2';
const ENGINEER_ID = '00000000-0000-0000-0000-0000000000a4';
const VITE_ENV = loadEnv('development', process.cwd(), 'VITE_');
const SUPABASE_URL = requireMatchingLocalSupabaseUrls(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_URL ?? VITE_ENV.VITE_SUPABASE_URL,
);
test.setTimeout(180_000);

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const need = <D>(step: string, r: { data: D; error: { message: string } | null }): NonNullable<D> => {
  if (r.error) throw new Error(`AC-HC-011 ${step}: ${r.error.message}`);
  if (r.data === null || r.data === undefined) throw new Error(`AC-HC-011 ${step}: no row returned`);
  return r.data as NonNullable<D>;
};

let admin: SupabaseClient;
let run = '';
let workOrderId = '';
let crewId = '';
let classId = '';
let className = '';

test.beforeEach(async () => {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-HC-011 needs SUPABASE_SERVICE_ROLE_KEY - run it via scripts/e2e-local.sh, which exports it');
  admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  run = `E2E-HC-${Date.now()}`;
  className = `Gate ${run}`;
  const from = new Date(); from.setDate(from.getDate() - 7);
  const projectId = need('project', await admin.from('projects')
    .insert({ org_id: ORG_ID, name: run, status: 'Ongoing Project', project_manager_id: PM_ID }).select('id').single()).id;
  workOrderId = need('work order', await admin.from('work_orders').insert({
    org_id: ORG_ID, project_id: projectId, title: `${run} gate`, status: 'Issued', order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0,
  }).select('id').single()).id;
  crewId = need('crew', await admin.from('crews').insert({
    org_id: ORG_ID, code: run.slice(-18), name: `${run} crew`, kind: 'own', field_controller_id: ENGINEER_ID,
  }).select('id').single()).id;
  need('roster', await admin.from('work_order_crews')
    .insert({ org_id: ORG_ID, work_order_id: workOrderId, crew_id: crewId, valid_from: iso(from) }).select('id').single());
  classId = need('class', await admin.from('labour_cost_classes').insert({ org_id: ORG_ID, code: run.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(-20), name: className }).select('id').single()).id;
  need('class rate', await admin.from('labour_cost_rates').insert({
    org_id: ORG_ID, subject_kind: 'class', class_id: classId, basis: 'daily', amount: 150000, overtime_multiplier: 1, day_hours: 8, month_hours: 173, effective_from: '2020-01-01',
  }).select('id').single());
});

test.afterEach(async () => {
  if (!admin || !crewId) return;
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  await admin.from('headcount_days').delete().eq('work_order_id', workOrderId);
  await admin.from('work_order_crews').update({ valid_to: iso(yesterday) }).eq('crew_id', crewId);
  await admin.from('labour_cost_rates').delete().eq('class_id', classId);
  await admin.from('labour_cost_classes').update({ archived_at: new Date().toISOString() }).eq('id', classId);
  crewId = '';
});

test('AC-HC-011 the foreman enters a head count and a different approver approves it', async ({ page, browser }) => {
  await signIn(page, 'engineer@acme.test');
  await page.goto(`/crews?view=attendance&wo=${workOrderId}`);
  await expect(page.getByText(/No head count entered for this day/)).toBeVisible();
  await page.getByRole('combobox', { name: 'Labour class' }).selectOption({ label: className });
  await page.getByRole('textbox', { name: 'Number of people' }).fill('6');
  await page.getByRole('button', { name: 'Save head count' }).click();
  const row = page.getByRole('row', { name: className });
  await expect(row).toContainText('6');
  await expect(row).toContainText('Waiting for approval');
  // The foreman is not an approver: no Approve button on the line.
  await expect(row.getByRole('button', { name: 'Approve' })).toHaveCount(0);

  const pmContext = await browser.newContext();
  const pmPage = await pmContext.newPage();
  await signIn(pmPage, 'pm@acme.test');
  await pmPage.goto(`/crews?view=attendance&wo=${workOrderId}`);
  const pmRow = pmPage.getByRole('row', { name: className });
  await expect(pmRow).toContainText('Waiting for approval');
  await pmRow.getByRole('button', { name: 'Approve' }).click();
  await expect(pmPage.getByRole('row', { name: className })).toContainText('Approved');
  await pmContext.close();

  const line = need('line', await admin.from('headcount_days').select('head_count, approved_by, approved_at, recorded_by_ids').eq('work_order_id', workOrderId).single());
  expect(line.head_count).toBe(6);
  expect(line.approved_at).not.toBeNull();
  expect(line.approved_by).toBe(PM_ID);
  expect(line.recorded_by_ids).toEqual([ENGINEER_ID]);
});
