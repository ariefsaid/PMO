// @e2e-isolation: serial - turns the seed organisation's labour cost switch on (an org-global singleton read by plan versus actual and the lock rules); resets it in afterEach.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { signIn, requireServiceRoleKey } from '../helpers';

// AC-NLL-014 (labour cost for crew members with no login): Finance adds a class rate, gives a person with no login a
// labour class from a date, sees it listed and ends it. Then the work-order page shows that person's approved
// attendance as labour cost in that class. Dates are in 2031 so nothing already costed is touched (the lock rules).
// ISOLATION: every row is created per run with a unique id and removed in afterEach, even on failure.
test.setTimeout(120_000);
const ORG_ID = '00000000-0000-0000-0000-000000000001';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const svcKey = requireServiceRoleKey();
if (!svcKey) throw new Error('AC-NLL-014: SUPABASE_SERVICE_ROLE_KEY is required for this owning journey - it must not silently skip.');
const admin = createClient(SUPABASE_URL, svcKey, { auth: { persistSession: false } });

const run = crypto.randomUUID().slice(0, 8);
const ids = { person: crypto.randomUUID(), project: crypto.randomUUID(), wo: crypto.randomUUID(), crew: crypto.randomUUID(), day: crypto.randomUUID() };
const personName = `No Login ${run}`;

test.afterEach(async () => {
  await admin.from('attendance_days').delete().eq('id', ids.day);
  await admin.from('labour_class_assignments').delete().eq('worker_id', ids.person);
  await admin.from('labour_cost_rates').delete().eq('org_id', ORG_ID).eq('subject_kind', 'class').gte('effective_from', '2031-01-01');
  await admin.from('crews').delete().eq('id', ids.crew);
  await admin.from('work_orders').delete().eq('id', ids.wo);
  await admin.from('projects').delete().eq('id', ids.project);
  await admin.from('people').delete().eq('id', ids.person);
  await admin.from('labour_cost_settings').delete().eq('org_id', ORG_ID);
});

test('AC-NLL-014 Finance adds a class rate and gives a crew member with no login a labour class', async ({ page }) => {
  await admin.from('people').insert({ id: ids.person, org_id: ORG_ID, kind: 'own', code: `NLL-${run}`, name: personName }).throwOnError();
  await admin.from('labour_cost_settings').upsert({ org_id: ORG_ID, enabled: true }).throwOnError();
  await admin.from('labour_cost_classes').upsert({ org_id: ORG_ID, code: 'direct', name: 'Direct' }, { onConflict: 'org_id,code', ignoreDuplicates: true }).throwOnError();

  await signIn(page, 'finance@acme.test');
  await page.goto('/administration/cost-attribution');
  const section = page.getByTestId('labour-cost-settings');
  await expect(section.getByRole('checkbox', { name: 'Cost approved hours in money' })).toBeChecked();

  await section.getByRole('button', { name: 'Add rate' }).click();
  const rate = page.getByRole('dialog', { name: 'Add rate' });
  await rate.getByLabel(/^Applies to/).selectOption('class');
  await rate.getByLabel('Amount').fill('40000');
  await rate.getByLabel(/^From/).fill('2031-02-01');
  await rate.getByRole('button', { name: 'Save rate' }).click();
  await expect(rate).toBeHidden();
  await expect(section.getByTestId('labour-rates').getByRole('row').filter({ hasText: '2031-02-01' })).toContainText('People with no login in this class');

  await section.getByRole('button', { name: 'Assign a class' }).click();
  const assign = page.getByRole('dialog', { name: 'Assign a class' });
  await assign.getByRole('combobox', { name: /Person/ }).click();
  await page.getByRole('option', { name: new RegExp(personName) }).click();
  await assign.getByLabel(/^From/).fill('2031-02-01');
  await assign.getByRole('button', { name: 'Save' }).click();
  await expect(assign).toBeHidden();
  const row = section.getByTestId('labour-class-assignments').getByRole('row').filter({ hasText: personName });
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: `End ${personName}` }).click();
  const end = page.getByRole('dialog', { name: 'End this class' });
  await end.getByLabel(/Last day/).fill('2031-12-31');
  await end.getByRole('button', { name: 'End' }).click();
  await expect(end).toBeHidden();
  await page.reload();
  await expect(page.getByTestId('labour-class-assignments').getByRole('row').filter({ hasText: personName })).not.toContainText('open');
});

test('AC-NLL-014 the work-order page shows approved no-login attendance as labour cost in its class', async ({ page }) => {
  const { data: org } = await admin.from('organizations').select('default_currency').eq('id', ORG_ID).single();
  const currency = org?.default_currency ?? 'USD';
  await admin.from('people').insert({ id: ids.person, org_id: ORG_ID, kind: 'own', code: `NLL-${run}`, name: personName }).throwOnError();
  await admin.from('projects').insert({ id: ids.project, org_id: ORG_ID, name: `NLL ${run}`, status: 'Ongoing Project', currency }).throwOnError();
  await admin.from('work_orders').insert({ id: ids.wo, org_id: ORG_ID, project_id: ids.project, wo_number: `WO-NLL-${run}`, title: 'No-login labour sample', status: 'Issued', order_value: 10000000, tax_treatment: 'exclusive', tax_amount: 0, currency }).throwOnError();
  await admin.from('crews').insert({ id: ids.crew, org_id: ORG_ID, code: `NLL-${run}`, name: `Crew ${run}` }).throwOnError();
  await admin.from('labour_cost_settings').upsert({ org_id: ORG_ID, enabled: true }).throwOnError();
  const { data: cls } = await admin.from('labour_cost_classes').upsert({ org_id: ORG_ID, code: 'direct', name: 'Direct' }, { onConflict: 'org_id,code' }).select('id').single();
  await admin.from('labour_cost_rates').insert({ org_id: ORG_ID, subject_kind: 'class', class_id: cls!.id, basis: 'hourly', amount: 40000, overtime_multiplier: 1.5, day_hours: 8, effective_from: '2031-01-01' }).throwOnError();
  await admin.from('labour_class_assignments').insert({ org_id: ORG_ID, worker_id: ids.person, class_id: cls!.id, effective_from: '2031-01-01' }).throwOnError();
  // An approved week of a person with no login is approved on the attendance itself (attendance_decide_week).
  await admin.from('attendance_days').insert({ id: ids.day, org_id: ORG_ID, worker_id: ids.person, work_order_id: ids.wo, project_id: ids.project, crew_id: ids.crew,
    work_date: '2031-01-06', status: 'present', hours: 8, overtime_hours: 2, source: 'roster_tick', submitted_at: new Date().toISOString(), approved_at: new Date().toISOString() }).throwOnError();

  await signIn(page, 'admin@acme.test');
  await page.goto(`/work-orders/${ids.wo}`);
  const block = page.getByTestId('wo-page-pva-labour');
  await expect(block).toBeVisible();
  // 8 h at 40000 + 2 h overtime at 40000 x 1.5 = 440000.
  await expect(block).toContainText('440,000');
  await expect(block).toContainText('10');
});
