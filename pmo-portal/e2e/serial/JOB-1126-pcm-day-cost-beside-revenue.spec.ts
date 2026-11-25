// @e2e-isolation: serial — switches the organisation's revenue-plan setting for the run and restores it in finally; the contract, work order, claim and validated report are this run's own and are deleted.
// #1126: the Project Control Manager opens a work order's daily view and sees each day's cost beside that day's revenue: the
// day's validated revenue, a supplier bill dated the same day, the day's cost and revenue less cost.
import { test, expect } from '@playwright/test';
import { need, ok, ORG_ID, runId, serviceClient, sqlAsOwner } from '../support/jobFixtures';
import { orgToday } from '../support/jobJourney';
import { roleJobUser } from '../support/roleJobUser';
import { formatExactMoney } from '../../src/lib/format';

test.setTimeout(180_000);

type Actor = Awaited<ReturnType<typeof roleJobUser>>;
const money = (value: string) => formatExactMoney(value, 'USD', 'en-US')!;

test('JOB-1126 the Project Control Manager sees the day\'s cost beside the day\'s revenue', async ({ page }) => {
  const svc = serviceClient('JOB-1126');
  const run = runId('JOB1126');
  const actor: Actor = await roleJobUser(svc, 'project_control_manager', run);
  const today = orgToday();
  const monthKey = `${today.slice(0, 7)}-01`;
  let hadSettings = false;
  let settingsRow: Record<string, unknown> | null = null;
  let projectId = ''; let woId = ''; let reportId = ''; let purchaseId = '';

  try {
    const settings = await svc.from('org_revenue_plan_settings').select('*').eq('org_id', ORG_ID).maybeSingle();
    settingsRow = settings.data as Record<string, unknown> | null;
    hadSettings = Boolean(settings.data);
    ok('setting on', await svc.from('org_revenue_plan_settings').upsert({ org_id: ORG_ID, enabled: true, working_weekdays: [1, 2, 3, 4, 5] }));

    projectId = need('project', await svc.from('projects').insert({
      org_id: ORG_ID, name: `${run} contract`, status: 'Ongoing Project', currency: 'USD', contract_value: 500_000,
      tax_treatment: 'exclusive', tax_amount: 0, project_manager_id: actor.id,
    }).select('id').single()).id as string;
    woId = crypto.randomUUID();
    ok('work order', await svc.from('work_orders').insert({
      id: woId, org_id: ORG_ID, project_id: projectId, title: `${run} works`, wo_number: `WO-${run}`, status: 'Issued',
      issued_at: new Date().toISOString(), order_value: 200_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD',
    }));
    // The month's target 2,200 with a distinct per-day figure: 120 today, the rest (2,080) on one other day of the month.
    // (Today is the 1st → the other day is the 2nd, still to come, so it counts in the month but not yet to date.)
    const otherDay = today === monthKey ? `${today.slice(0, 7)}-02` : monthKey;
    ok('plan', await svc.from('work_order_revenue_plan').insert([
      { org_id: ORG_ID, project_id: projectId, work_order_id: woId, plan_date: today, amount: 120, source: 'date' },
      { org_id: ORG_ID, project_id: projectId, work_order_id: woId, plan_date: otherDay, amount: 2_080, source: 'date' },
    ]));
    const boqId = need('contract line', await svc.from('boq_items').insert({
      org_id: ORG_ID, project_id: projectId, item_code: `L-${run}`, description: `${run} measured work`, unit: 'm', quantity: 100, rate: 10,
    }).select('id').single()).id as string;
    const lineId = need('work-order line', await svc.from('work_order_lines').insert({ org_id: ORG_ID, work_order_id: woId, boq_item_id: boqId, quantity: 100 }).select('id').single()).id as string;
    // A validated report today: 5 measured at 10 → today's revenue 50.00. Another person validated it: the author never does.
    const validator = need('validator profile', await svc.from('profiles').select('id').eq('org_id', ORG_ID).eq('email', 'finance@acme.test').single()).id as string;
    reportId = need('report', await svc.from('daily_site_reports').insert({
      org_id: ORG_ID, project_id: projectId, work_order_id: woId, work_date: today, status: 'validated',
      author_id: actor.id, validated_by: validator, validated_at: new Date().toISOString(),
    }).select('id').single()).id as string;
    ok('progress', await svc.from('dsr_progress_lines').insert({
      org_id: ORG_ID, report_id: reportId, position: 1, work_order_line_id: lineId, quantity: 5, unit: 'm',
      frozen_rate: 10, frozen_rate_source: 'contract', frozen_amount: 50, frozen_at: new Date().toISOString(),
    }));

    // A supplier bill of 7 for this work order, dated today: the cost on today's row, under Material.
    purchaseId = need('purchase', await svc.from('procurements').insert({
      org_id: ORG_ID, project_id: projectId, title: `${run} cement`, code: `P-${run}`, status: 'Vendor Invoiced', requested_by_id: actor.id, total_value: 7, currency: 'USD',
    }).select('id').single()).id as string;
    ok('bill', await svc.from('procurement_invoices').insert({
      org_id: ORG_ID, procurement_id: purchaseId, work_order_id: woId, vi_number: `VI-${run}`, status: 'Received', amount: 7, currency: 'USD',
      tax_treatment: 'exclusive', tax_amount: 0, invoice_date: today,
    }));

    await actor.signIn(page);
    await page.goto(`/work-orders/${woId}`);
    const daily = page.getByTestId('wo-page-daily-target');
    await expect(daily).toBeVisible({ timeout: 30_000 });
    await expect(daily).not.toContainText('restricted for your role');

    // The day: its revenue (50), the bill's cost (7) under Material, the day's cost and revenue less cost (43); nothing spread.
    const row = daily.getByTestId(`wo-daily-cost-row-${today}`);
    await expect(row).toBeVisible();
    await expect(daily.getByTestId(`wo-daily-cost-material-${today}`)).toHaveText(money('7.00'));
    await expect(daily.getByTestId(`wo-daily-cost-total-${today}`)).toHaveText(money('7.00'));
    await expect(daily.getByTestId(`wo-daily-cost-net-${today}`)).toHaveText(money('43.00'));
    await expect(daily.getByTestId('wo-daily-cost-undated')).toHaveCount(0);
    // The revenue side of the same day is unchanged.
    await expect(daily.getByTestId(`wo-daily-row-${today}`).locator('td').nth(1)).toHaveText(money('50.00'));
  } finally {
    if (purchaseId) sqlAsOwner(`delete from public.procurement_invoices where procurement_id = '${purchaseId}'; delete from public.record_changes where entity_id = '${purchaseId}'; delete from public.procurements where id = '${purchaseId}';`);
    if (reportId) sqlAsOwner(`delete from public.dsr_progress_lines where report_id = '${reportId}'; delete from public.daily_site_reports where id = '${reportId}';`);
    if (projectId) {
      sqlAsOwner(`delete from public.work_order_revenue_plan where work_order_id = '${woId}';
        delete from public.work_order_lines where work_order_id = '${woId}';
        delete from public.work_orders where id = '${woId}';
        delete from public.boq_items where project_id = '${projectId}';
        delete from public.record_changes where entity_id = '${projectId}';
        delete from public.projects where id = '${projectId}';`);
    }
    if (hadSettings && settingsRow) {
      ok('restore setting', await svc.from('org_revenue_plan_settings').upsert(settingsRow));
    } else if (!hadSettings) {
      ok('restore setting', await svc.from('org_revenue_plan_settings').delete().eq('org_id', ORG_ID));
    }
    await actor.cleanup();
  }
});
