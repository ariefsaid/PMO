// @e2e-isolation: self-isolated — creates its own uniquely-named projects, asset, ledger account, account-map row, ledger line, usage and costing setting each run and deletes them afterwards; reads the seed org and its seeded users only.
/**
 * AC-EQU-019 — equipment usage and allocation (#1519): the cross-stack journey. The Engineer logs one machine on two projects
 * in a past week and submits it; the Project Manager (who manages both) approves the week; Finance sets the machine to
 * "Actual cost by usage" and the month's depreciation (800.00, on no project) is shared by logged hours, 6 h to 2 h.
 * Goal oracle: each project's Finances panel shows its own allocated amount (600 and 200), never a panel without a number.
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { signIn, requireServiceRoleKey, pickComboboxOption } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const PM_ID = '00000000-0000-0000-0000-0000000000a2';
const VITE_ENV = loadEnv('development', process.cwd(), 'VITE_');
const SUPABASE_URL = requireMatchingLocalSupabaseUrls(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_URL ?? VITE_ENV.VITE_SUPABASE_URL,
);

test.setTimeout(240_000);

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

let admin: SupabaseClient | undefined;
let run = '';
let projectA = ''; let projectB = ''; let assetId = '';
let accountId = ''; let mapId = ''; let glId = '';

const ok = <T>(step: string, r: { data: T; error: { message: string } | null }): T => {
  if (r.error) throw new Error(`AC-EQU-019 ${step}: ${r.error.message}`);
  return r.data;
};
const need = <D>(step: string, r: { data: D; error: { message: string } | null }): NonNullable<D> => {
  const data = ok(step, r);
  if (data === null || data === undefined) throw new Error(`AC-EQU-019 ${step}: no row returned`);
  return data as NonNullable<D>;
};

// The 15th of last month: a past day in a month that is complete, so the month's cost pool and the logged hours share one calendar month.
const today = new Date();
const workDay = new Date(today.getFullYear(), today.getMonth() - 1, 15);
const firstOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
const weekdayIndex = (workDay.getDay() + 6) % 7; // Monday = 0: the cell's position in the row

test.beforeEach(async () => {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-EQU-019 needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh, which exports it');
  admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  run = `E2E-EQU-${Date.now()}`;

  projectA = need('project A', await admin.from('projects').insert({ org_id: ORG_ID, name: `${run} A`, status: 'Ongoing Project', project_manager_id: PM_ID }).select('id').single()).id;
  projectB = need('project B', await admin.from('projects').insert({ org_id: ORG_ID, name: `${run} B`, status: 'Ongoing Project', project_manager_id: PM_ID }).select('id').single()).id;
  assetId = need('asset', await admin.from('equipment_assets').insert({ org_id: ORG_ID, code: run, name: run, default_unit: 'hours' }).select('id').single()).id;
  const account = `${run} Depreciation`;
  accountId = need('account', await admin.from('erp_account_mirror').insert({
    org_id: ORG_ID, company: 'E2E', erp_name: account, account_name: account, root_type: 'Expense', report_type: 'Profit and Loss',
    parent_account: null, is_group: false, account_currency: 'IDR', lft: 9000, rgt: 9001, refresh_id: crypto.randomUUID(),
  }).select('id').single()).id;
  mapId = need('account map', await admin.from('budget_category_account_map').insert({ org_id: ORG_ID, category: 'Equipment', erp_account: account, is_push_target: false }).select('id').single()).id;
  glId = need('ledger line', await admin.from('erp_gl_entry_mirror').insert({
    org_id: ORG_ID, erp_name: `${run}-GL`, company: 'E2E', account, cost_center: `${run} CC`, fiscal_year: String(firstOfLastMonth.getFullYear()),
    project: null, party_type: null, party: null, posting_date: iso(workDay), debit: 800, credit: 0, is_cancelled: false, erp_modified: '1',
  }).select('id').single()).id;
});

test.afterEach(async () => {
  if (!admin || !assetId) return;
  const fail = (step: string, e: { message: string } | null) => { if (e) throw new Error(`AC-EQU-019 cleanup ${step}: ${e.message}`); };
  // Settings and entries first (the asset FK-blocks while they exist), then the asset, the ledger rows and the projects.
  fail('settings', (await admin.from('equipment_costing_settings').delete().eq('asset_id', assetId)).error);
  fail('entries', (await admin.from('equipment_usage_entries').delete().eq('asset_id', assetId)).error);
  fail('asset', (await admin.from('equipment_assets').delete().eq('id', assetId)).error);
  fail('ledger line', (await admin.from('erp_gl_entry_mirror').delete().eq('id', glId)).error);
  fail('map', (await admin.from('budget_category_account_map').delete().eq('id', mapId)).error);
  fail('account', (await admin.from('erp_account_mirror').delete().eq('id', accountId)).error);
  fail('projects', (await admin.from('projects').delete().in('id', [projectA, projectB])).error);
  assetId = '';
});

test('AC-EQU-019 log on two projects, approve, set actual-cost basis, see both allocated amounts on the project Finances panel', async ({ page }) => {
  const week = `/equipment?week=${iso(workDay)}`;
  const nameA = `${run} A`; const nameB = `${run} B`;

  // 1. The Engineer logs 6 h on project A and 2 h on project B for the machine on the 15th of last month, then submits the week.
  await signIn(page, 'engineer@acme.test');
  for (const [name, hours] of [[nameA, '6'], [nameB, '2']] as const) {
    await page.goto(week);
    await page.getByRole('button', { name: 'Add row' }).click();
    await pickComboboxOption(page, page, /^Equipment/, new RegExp(run));
    await pickComboboxOption(page, page, /^Project/, new RegExp(`${name}$`));
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const row = page.getByRole('row', { name: new RegExp(`${run}.*${name}$|${name}.*${run}`) }).first();
    const cell = row.getByRole('textbox').nth(weekdayIndex);
    await cell.fill(hours);
    await cell.press('Enter');
    await expect(row.getByText('Draft')).toBeVisible({ timeout: 15_000 });
  }
  await page.getByRole('button', { name: 'Submit week' }).click();
  await expect(page.getByText('Submitted', { exact: true })).toHaveCount(2, { timeout: 15_000 });

  // 2. The Project Manager (manages both projects) approves the asset-week from the Approvals tab.
  await signIn(page, 'pm@acme.test');
  await page.goto(week);
  await page.getByRole('tab', { name: 'Approvals' }).click();
  await page.getByRole('button', { name: 'Approve week' }).click();
  await expect(page.getByText('Nothing is waiting for approval this week')).toBeVisible({ timeout: 15_000 });

  // 3. Finance costs the machine by actual cost, shared by logged hours, from the first of last month.
  await signIn(page, 'finance@acme.test');
  await page.goto(`/equipment/assets/${assetId}`);
  await page.getByRole('button', { name: 'Change costing' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: 'Actual cost by usage' }).check();
  await dialog.getByRole('textbox', { name: /Ledger account$/ }).fill(`${run} Depreciation`);
  await dialog.getByRole('textbox', { name: /Cost centre/ }).fill(`${run} CC`);
  await dialog.getByLabel('Effective from').fill(iso(firstOfLastMonth));
  await dialog.getByRole('button', { name: 'Preview' }).click();
  await expect(dialog.getByRole('table', { name: /Preview/ })).toContainText(/600/, { timeout: 20_000 });
  await dialog.getByRole('button', { name: 'Save costing' }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  // 4. Goal oracle: each project's Finances panel carries its own allocated amount.
  await signIn(page, 'pm@acme.test');
  for (const [projectId, amount] of [[projectA, /600/], [projectB, /200/]] as const) {
    await page.goto(`/projects/${projectId}`);
    await page.getByRole('region', { name: 'Money position' }).getByRole('button', { name: 'Details', exact: true }).click();
    await expect(page.getByTestId('project-equipment-panel').getByText(amount)).toBeVisible({ timeout: 20_000 });
  }
});
