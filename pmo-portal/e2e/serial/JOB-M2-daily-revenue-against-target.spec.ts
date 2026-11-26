// @e2e-isolation: serial — switches the organisation's revenue-plan setting for the run and restores it in finally; the contract, work order, plan row and validated report are this run's own and are deleted.
// JOB-M2 (acceptance 01-management, TC-M-02): daily revenue against a target. A work order with a monthly revenue target and a
// validated report: the Executive opens the work order's daily revenue and sees the day's revenue against its target and the
// gap, with the month-to-date figure. (The acceptance script names "Daily revenue"; the shipped section is "Daily target".)
import { test, expect } from '@playwright/test';
import { need, ok, ORG_ID, runId, serviceClient, sqlAsOwner } from '../support/jobFixtures';
import { orgToday } from '../support/jobJourney';
import { roleJobUser } from '../support/roleJobUser';
import { formatTableMoney } from '../../src/lib/format';
import { openWorkOrderArea } from '../support/workOrderArea';

test.setTimeout(180_000);

type Actor = Awaited<ReturnType<typeof roleJobUser>>;
// Read-only money reads in whole units (screen rules), through the app's own table formatter.
const money = (value: string) => formatTableMoney(value, 'USD')!;

test('JOB-M2 the Executive sees the day\'s revenue against its target, the gap, and the month to date', async ({ page }) => {
  const svc = serviceClient('JOB-M2');
  const run = runId('JOBM2');
  const actor: Actor = await roleJobUser(svc, 'executive', run);
  const today = orgToday();
  const monthKey = `${today.slice(0, 7)}-01`;
  let hadSettings = false;
  let settingsRow: Record<string, unknown> | null = null;
  let projectId = ''; let woId = ''; let reportId = '';

  try {
    const settings = await svc.from('org_revenue_plan_settings').select('*').eq('org_id', ORG_ID).maybeSingle();
    settingsRow = settings.data as Record<string, unknown> | null;
    hadSettings = Boolean(settings.data);
    ok('setting on', await svc.from('org_revenue_plan_settings').upsert({ org_id: ORG_ID, enabled: true, working_weekdays: [1, 2, 3, 4, 5] }));

    projectId = need('project', await svc.from('projects').insert({
      org_id: ORG_ID, name: `${run} contract`, status: 'Ongoing Project', currency: 'USD', contract_value: 500_000,
      tax_treatment: 'exclusive', tax_amount: 0,
    }).select('id').single()).id as string;
    woId = crypto.randomUUID();
    ok('work order', await svc.from('work_orders').insert({
      id: woId, org_id: ORG_ID, project_id: projectId, title: `${run} works`, wo_number: `WO-${run}`, status: 'Issued',
      issued_at: new Date().toISOString(), order_value: 200_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD',
    }));
    // The month's target 2,200 with a distinct per-day figure: 120 today, the rest (2,080) on one other day of the month.
    // (Today is the 1st → the other day is the 2nd, still to come, so it counts in the month but not yet to date.)
    const otherDay = today === monthKey ? `${today.slice(0, 7)}-02` : monthKey;
    const mtdTarget = today === monthKey ? 120 : 2_200;
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

    await actor.signIn(page);
    await page.goto(`/work-orders/${woId}`);
    await openWorkOrderArea(page, 'cost');
    const daily = page.getByTestId('wo-page-daily-target');
    await expect(daily).toBeVisible({ timeout: 30_000 });
    await expect(daily).not.toContainText('restricted for your role');

    // The day itself: today's revenue next to its target and the gap.
    const todayRow = daily.getByTestId(`wo-daily-row-${today}`);
    await expect(todayRow).toBeVisible();
    await expect(todayRow.locator('td').nth(0)).toHaveText(money('120.00'));
    await expect(todayRow.locator('td').nth(1)).toHaveText(money('50.00'));
    await expect(todayRow.locator('td').nth(2)).toHaveText(`${money('70.00')} behind target`);
    // The month to date: the target so far, the actual, and the gap said in words.
    await expect(daily.getByTestId('wo-daily-mtd-target')).toHaveText(money(mtdTarget.toFixed(2)));
    await expect(daily.getByTestId('wo-daily-mtd-actual')).toHaveText(money('50.00'));
    await expect(daily.getByTestId('wo-daily-mtd-gap')).toContainText(/behind target|ahead of target|On target/);
    await expect(daily.getByTestId('wo-daily-mtd-gap')).toContainText(`${money((mtdTarget - 50).toFixed(2))} behind target`);
    await expect(daily.getByTestId('wo-daily-projection')).not.toHaveText('Not enough working days yet');
  } finally {
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
