// @e2e-isolation: serial - turns the seed organisation's labour cost switch on and off (an org-global singleton read by plan versus actual); resets it in afterEach.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { signIn, requireServiceRoleKey } from '../helpers';

// AC-LCM-018 (labour cost in money, #2670): an Admin turns labour cost on, adds a cost rate for a role from a future date,
// sees it listed, and ends it. The rate starts in 2031 so it never touches an hour already priced (the lock rule).
// ISOLATION: the switch and the rate are reset in afterEach, even on failure.
test.setTimeout(120_000);
test.use({ deviceScaleFactor: 2 });
const EVIDENCE = '../docs/evidence/1215/2670';
const shots = async (page: import('@playwright/test').Page, locator: import('@playwright/test').Locator, name: string) => {
  for (const [label, width, height] of [['phone', 390, 844], ['desktop', 1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    await locator.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${EVIDENCE}/${name}-${label}.png`, fullPage: true });
  }
};
const ORG_ID = '00000000-0000-0000-0000-000000000001';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const svcKey = requireServiceRoleKey();
if (!svcKey) throw new Error('AC-LCM-018: SUPABASE_SERVICE_ROLE_KEY is required for this owning journey - it must not silently skip.');
const admin = createClient(SUPABASE_URL, svcKey, { auth: { persistSession: false } });

test.afterEach(async () => {
  await admin.from('labour_cost_rates').delete().eq('org_id', ORG_ID).gte('effective_from', '2031-01-01');
  await admin.from('labour_cost_settings').delete().eq('org_id', ORG_ID);
});

test('AC-LCM-018 Admin switches labour cost on and adds a role rate', async ({ page }) => {
  await signIn(page, 'admin@acme.test');
  await page.goto('/administration/cost-attribution');
  const section = page.getByTestId('labour-cost-settings');
  const toggle = section.getByRole('checkbox', { name: 'Cost approved hours in money' });
  await expect(toggle).not.toBeChecked();
  // The switch flips after the save round-trip (a controlled checkbox), so click and wait for the saved state.
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(section.getByRole('button', { name: 'Add rate' })).toBeVisible();
  await expect(section.getByTestId('labour-classes').getByText('Direct', { exact: true })).toBeVisible();

  await section.getByRole('button', { name: 'Add rate' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add rate' });
  await dialog.getByLabel('Role', { exact: false }).first().selectOption({ index: 1 });
  await dialog.getByLabel('Amount').fill('55000');
  await dialog.getByLabel('Overtime multiplier').fill('1.5');
  await dialog.getByLabel(/^From/).fill('2031-01-01');
  await dialog.getByRole('button', { name: 'Save rate' }).click();
  await expect(dialog).toBeHidden();
  const row = section.getByTestId('labour-rates').getByRole('row').filter({ hasText: '2031-01-01' });
  await expect(row).toContainText('Overtime ×1.5');

  await shots(page, section, 'labour-cost-settings');
  await page.reload();
  await expect(page.getByTestId('labour-cost-settings').getByRole('checkbox', { name: 'Cost approved hours in money' })).toBeChecked();
  await expect(page.getByTestId('labour-rates').getByRole('row').filter({ hasText: '2031-01-01' })).toBeVisible();
});

test('AC-LCM-019 the work-order page shows priced labour by class', async ({ page }) => {
  const ids = { project: crypto.randomUUID(), wo: crypto.randomUUID(), sheet: crypto.randomUUID(), entry: crypto.randomUUID() };
  const { data: eng } = await admin.from('profiles').select('id').eq('email', 'engineer@acme.test').single();
  if (!eng) throw new Error('AC-LCM-019: seed engineer missing');
  // Labour is priced in the organisation currency, so the fixture's project and work order use it (another currency lists apart).
  const { data: org } = await admin.from('organizations').select('default_currency').eq('id', ORG_ID).single();
  const currency = org?.default_currency ?? 'USD';
  try {
    await admin.from('projects').insert({ id: ids.project, org_id: ORG_ID, name: `LCM 2670 ${ids.project}`, status: 'Ongoing Project', currency }).throwOnError();
    await admin.from('work_orders').insert({ id: ids.wo, org_id: ORG_ID, project_id: ids.project, wo_number: 'WO-LCM', title: 'Labour cost sample', status: 'Issued', order_value: 10000000, tax_treatment: 'exclusive', tax_amount: 0, currency }).throwOnError();
    await admin.from('timesheets').insert({ id: ids.sheet, org_id: ORG_ID, user_id: eng.id, week_start_date: '2031-01-06', status: 'Approved' }).throwOnError();
    await admin.from('timesheet_entries').insert([
      { id: ids.entry, org_id: ORG_ID, timesheet_id: ids.sheet, project_id: ids.project, work_order_id: ids.wo, entry_date: '2031-01-06', hours: 10 },
    ]).throwOnError();
    await admin.from('labour_cost_settings').upsert({ org_id: ORG_ID, enabled: true }).throwOnError();
    const { data: cls } = await admin.from('labour_cost_classes').upsert({ org_id: ORG_ID, code: 'direct', name: 'Direct' }, { onConflict: 'org_id,code' }).select('id').single();
    await admin.from('labour_cost_rates').insert({ org_id: ORG_ID, subject_kind: 'role', role_key: 'Engineer', class_id: cls!.id, basis: 'hourly', amount: 50000, overtime_multiplier: 1.5, day_hours: 8, effective_from: '2031-01-01' }).throwOnError();

    await signIn(page, 'admin@acme.test');
    await page.goto(`/work-orders/${ids.wo}`);
    const block = page.getByTestId('wo-page-pva-labour');
    await expect(block).toBeVisible();
    // 8 h at 50000 + 2 h overtime at 50000 x 1.5 = 550000.
    await expect(block).toContainText('550,000');
    await expect(block).toContainText('10');
    await shots(page, block, 'work-order-labour-by-class');
  } finally {
    await admin.from('labour_cost_rates').delete().eq('org_id', ORG_ID).gte('effective_from', '2031-01-01');
    await admin.from('timesheet_entries').delete().eq('id', ids.entry);
    await admin.from('timesheets').delete().eq('id', ids.sheet);
    await admin.from('work_orders').delete().eq('id', ids.wo);
    await admin.from('projects').delete().eq('id', ids.project);
  }
});
