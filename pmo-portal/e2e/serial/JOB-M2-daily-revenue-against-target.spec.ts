// @e2e-isolation: serial — switches the organisation's revenue-plan setting for the run and restores it in finally; the contract, work order, plan row and validated report are this run's own and are deleted.
// JOB-M2 (acceptance 01-management, TC-M-02): daily revenue against a target. A work order with a monthly revenue target and a
// validated report: the Executive opens the work order's daily revenue and sees the day's revenue against its target and the
// gap, with the month-to-date figure. (The acceptance script names "Daily revenue"; the shipped section is "Daily target".)
import { test, expect } from '@playwright/test';
import { need, ok, ORG_ID, runId, serviceClient, sqlAsOwner } from '../support/jobFixtures';
import { orgToday } from '../support/jobJourney';
import { roleJobUser } from '../support/roleJobUser';
import { formatExactMoney } from '../../src/lib/format';

test.setTimeout(180_000);

type Actor = Awaited<ReturnType<typeof roleJobUser>>;
const money = (value: string) => formatExactMoney(value, 'USD', 'en-US')!;

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
    // The month's target: 2,200 spread over the month's working days (the shipped "Enter plan" month amount).
    ok('plan', await svc.from('work_order_revenue_plan').insert({
      org_id: ORG_ID, project_id: projectId, work_order_id: woId, plan_date: monthKey, amount: 2_200, source: 'month', month_key: monthKey,
    }));
    const boqId = need('contract line', await svc.from('boq_items').insert({
      org_id: ORG_ID, project_id: projectId, item_code: `L-${run}`, description: `${run} measured work`, unit: 'm', quantity: 100, rate: 10,
    }).select('id').single()).id as string;
    const lineId = need('work-order line', await svc.from('work_order_lines').insert({ org_id: ORG_ID, work_order_id: woId, boq_item_id: boqId, quantity: 100 }).select('id').single()).id as string;
    // A validated report today: 5 measured at 10 → today's revenue 50.00.
    reportId = need('report', await svc.from('daily_site_reports').insert({
      org_id: ORG_ID, project_id: projectId, work_order_id: woId, work_date: today, status: 'validated',
      author_id: actor.id, validated_by: actor.id, validated_at: new Date().toISOString(),
    }).select('id').single()).id as string;
    ok('progress', await svc.from('dsr_progress_lines').insert({
      org_id: ORG_ID, report_id: reportId, position: 1, work_order_line_id: lineId, quantity: 5, unit: 'm',
      frozen_rate: 10, frozen_rate_source: 'contract', frozen_amount: 50, frozen_at: new Date().toISOString(),
    }));

    await actor.signIn(page);
    await page.goto(`/work-orders/${woId}`);
    const daily = page.getByTestId('wo-page-daily-target');
    await expect(daily).toBeVisible({ timeout: 30_000 });
    await expect(daily).not.toContainText('restricted for your role');

    // The day itself: today's revenue next to its target and the gap.
    const todayRow = daily.getByTestId(`wo-daily-row-${today}`);
    await expect(todayRow).toBeVisible();
    await expect(todayRow).toContainText(money('50.00'));
    // The month to date: the target so far, the actual, and the gap said in words.
    await expect(daily.getByTestId('wo-daily-mtd-target')).not.toHaveText('No target entered');
    await expect(daily.getByTestId('wo-daily-mtd-actual')).toHaveText(money('50.00'));
    await expect(daily.getByTestId('wo-daily-mtd-gap')).toContainText(/behind target|ahead of target|On target/);
    await expect(daily.getByTestId('wo-daily-mtd-gap')).toContainText('behind target');
    await expect(daily.getByTestId('wo-daily-projection')).not.toHaveText('Not enough working days yet');
  } finally {
    if (reportId) sqlAsOwner(`delete from public.dsr_progress_lines where report_id = '${reportId}'; delete from public.daily_site_reports where id = '${reportId}';`);
    if (projectId) {
      sqlAsOwner(`delete from public.work_order_revenue_plan where work_order_id = '${woId}';
        delete from public.work_order_lines where work_order_id = '${woId}';
        delete from public.work_orders where id = '${woId}';
        delete from public.boq_items where project_id = '${projectId}';
        delete from public.record_changes where entity_id = '${projectId}'::text;
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
