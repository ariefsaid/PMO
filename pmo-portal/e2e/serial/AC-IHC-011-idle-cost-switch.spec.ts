// @e2e-isolation: serial - turns the seed organisation's labour cost switch on and off (an org-global singleton read by plan versus actual); resets it in the finally block.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { signIn, requireServiceRoleKey } from '../helpers';
import { openWorkOrderArea } from '../support/workOrderArea';

// AC-IHC-011 (idle hours as cost, #2673): a person sees idle time as cost per reason on the work order's plan versus actual
// once labour cost in money is on. Idle time as cost is on by default for every organisation (#2746), so there is no switch to flip:
// with labour cost off the block is absent, with it on the block lists each reason with its hours and cost and a total.
// ISOLATION: the labour cost switch, its rate and every fixture row are removed in the finally block, even on failure.
test.setTimeout(120_000);
test.use({ deviceScaleFactor: 2 });
const EVIDENCE = '../docs/evidence/1215/2673';
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
if (!svcKey) throw new Error('AC-IHC-011: SUPABASE_SERVICE_ROLE_KEY is required for this owning journey - it must not silently skip.');
const admin = createClient(SUPABASE_URL, svcKey, { auth: { persistSession: false } });

test('AC-IHC-011 idle time shows as cost per reason on the work order once labour cost is on', async ({ page }) => {
  const ids = {
    project: crypto.randomUUID(), wo: crypto.randomUUID(), sheet: crypto.randomUUID(), entry: crypto.randomUUID(),
    report: crypto.randomUUID(), reasonA: crypto.randomUUID(), reasonB: crypto.randomUUID(),
  };
  const { data: eng } = await admin.from('profiles').select('id').eq('email', 'engineer@acme.test').single();
  const { data: boss } = await admin.from('profiles').select('id').eq('email', 'admin@acme.test').single();
  if (!eng || !boss) throw new Error('AC-IHC-011: seed engineer or admin missing');
  const { data: org } = await admin.from('organizations').select('default_currency').eq('id', ORG_ID).single();
  const currency = org?.default_currency ?? 'USD';
  const at = '2031-01-06T08:00:00Z';
  try {
    await admin.from('projects').insert({ id: ids.project, org_id: ORG_ID, name: `IHC 2673 ${ids.project}`, status: 'Ongoing Project', currency }).throwOnError();
    await admin.from('work_orders').insert({ id: ids.wo, org_id: ORG_ID, project_id: ids.project, wo_number: 'WO-IHC', title: 'Idle cost sample', status: 'Issued', order_value: 10000000, tax_treatment: 'exclusive', tax_amount: 0, currency }).throwOnError();
    // 8 approved hours at a role rate of 50000 an hour: the work order's hourly cost is 50000.
    await admin.from('timesheets').insert({ id: ids.sheet, org_id: ORG_ID, user_id: eng.id, week_start_date: '2031-01-06', status: 'Approved' }).throwOnError();
    await admin.from('timesheet_entries').insert({ id: ids.entry, org_id: ORG_ID, timesheet_id: ids.sheet, project_id: ids.project, work_order_id: ids.wo, entry_date: '2031-01-06', hours: 8 }).throwOnError();
    const { data: cls } = await admin.from('labour_cost_classes').upsert({ org_id: ORG_ID, code: 'direct', name: 'Direct' }, { onConflict: 'org_id,code' }).select('id').single();
    await admin.from('labour_cost_rates').insert({ org_id: ORG_ID, subject_kind: 'role', role_key: 'Engineer', class_id: cls!.id, basis: 'hourly', amount: 50000, overtime_multiplier: 1.5, day_hours: 8, effective_from: '2031-01-01' }).throwOnError();
    // One validated site report with two idle periods: 30 minutes for each of two reasons.
    await admin.from('dsr_idle_reasons').insert([
      { id: ids.reasonA, org_id: ORG_ID, label: 'IHC Rain' }, { id: ids.reasonB, org_id: ORG_ID, label: 'IHC No material' },
    ]).throwOnError();
    await admin.from('daily_site_reports').insert({ id: ids.report, org_id: ORG_ID, project_id: ids.project, work_order_id: ids.wo, work_date: '2031-01-06', status: 'validated', author_id: eng.id, validated_by: boss.id, validated_at: at, submitted_at: at }).throwOnError();
    await admin.from('dsr_idle_periods').insert([
      { org_id: ORG_ID, report_id: ids.report, position: 1, minutes: 30, reason_id: ids.reasonA },
      { org_id: ORG_ID, report_id: ids.report, position: 2, minutes: 30, reason_id: ids.reasonB },
    ]).throwOnError();

    await signIn(page, 'admin@acme.test');
    // Labour cost off: nothing about idle cost shows, whatever idle time was recorded.
    await page.goto(`/work-orders/${ids.wo}`);
    await openWorkOrderArea(page, 'cost');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('wo-page-pva-idle')).toHaveCount(0);

    // Labour cost on: each reason lists 0.5 h at 50000 an hour, the total 1 h and 50000.
    await admin.from('labour_cost_settings').upsert({ org_id: ORG_ID, enabled: true }).throwOnError();
    await page.goto(`/work-orders/${ids.wo}`);
    await openWorkOrderArea(page, 'cost');
    const block = page.getByTestId('wo-page-pva-idle');
    await expect(block).toBeVisible();
    await expect(page.getByTestId(`wo-page-pva-idle-${ids.reasonA}`)).toContainText('IHC Rain');
    await expect(page.getByTestId(`wo-page-pva-idle-${ids.reasonA}`)).toContainText('25,000');
    await expect(page.getByTestId(`wo-page-pva-idle-${ids.reasonB}`)).toContainText('IHC No material');
    await expect(page.getByTestId(`wo-page-pva-idle-${ids.reasonB}`)).toContainText('25,000');
    await expect(page.getByTestId('wo-page-pva-idle-total')).toContainText('50,000');
    await shots(page, block, 'idle-cost-by-reason');
  } finally {
    await admin.from('labour_cost_settings').delete().eq('org_id', ORG_ID);
    await admin.from('labour_cost_rates').delete().eq('org_id', ORG_ID).gte('effective_from', '2031-01-01');
    await admin.from('dsr_idle_periods').delete().eq('report_id', ids.report);
    await admin.from('daily_site_reports').delete().eq('id', ids.report);
    await admin.from('dsr_idle_reasons').delete().in('id', [ids.reasonA, ids.reasonB]);
    await admin.from('timesheet_entries').delete().eq('id', ids.entry);
    await admin.from('timesheets').delete().eq('id', ids.sheet);
    await admin.from('work_orders').delete().eq('id', ids.wo);
    await admin.from('projects').delete().eq('id', ids.project);
  }
});
