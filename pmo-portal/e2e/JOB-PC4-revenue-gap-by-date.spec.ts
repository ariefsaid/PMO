// @e2e-isolation: self-isolated — owns its project-manager and project-control-manager logins, project, work order, validated progress and revenue plan; deletes them in finally without changing org settings.
// JOB-PC4 (project control): revenue gap by date. The project manager supplies a dated revenue plan on a work order;
// the project control manager reads plan to date, actual to date from validated progress, and the gap on both work-order and project screens.
import { test, expect } from '@playwright/test';
import { formatTableMoney } from '../src/lib/format';
import { cleanupAll, need, ok, ORG_ID, runId, serviceClient } from './support/jobFixtures';
import { ENGINEER_ID, inDays } from './support/jobJourney';
import { roleJobUser } from './support/roleJobUser';
import { openWorkOrderArea } from './support/workOrderArea';

test.setTimeout(120_000);

test('JOB-PC4 project control manager reads plan to date, actual to date, and revenue gap after the project manager enters a dated plan', async ({ page }) => {
  const svc = serviceClient('JOB-PC4');
  const run = runId('JOBPC4');
  const pm = await roleJobUser(svc, 'project_manager', `${run}-pm`);
  const pcm = await roleJobUser(svc, 'project_control_manager', `${run}-pcm`);

  let projectId = '';
  let woId = '';
  let boqId = '';
  let reportId = '';

  try {
    // Precondition: revenue planning is enabled by default for the organisation (migration 1670); never mutated here.
    const setting = need('revenue plan setting', await svc.from('org_revenue_plan_settings')
      .select('enabled').eq('org_id', ORG_ID).single());
    expect(setting.enabled).toBe(true);

    projectId = need('project', await svc.from('projects').insert({
      org_id: ORG_ID,
      name: `${run} project`,
      status: 'Ongoing Project',
      currency: 'USD',
      project_manager_id: pm.id,
      contract_value: 500_000,
      tax_treatment: 'exclusive',
      tax_amount: 0,
    }).select('id').single()).id as string;

    woId = crypto.randomUUID();
    ok('work order', await svc.from('work_orders').insert({
      id: woId,
      org_id: ORG_ID,
      project_id: projectId,
      title: `${run} mainline`,
      status: 'Issued',
      wo_number: `WO-${run}`,
      issued_at: new Date().toISOString(),
      order_value: 100_000,
      tax_treatment: 'exclusive',
      tax_amount: 0,
      currency: 'USD',
    }));

    boqId = need('boq item', await svc.from('boq_items').insert({
      org_id: ORG_ID,
      project_id: projectId,
      item_code: `LIN-${run.slice(-6)}`,
      description: `${run} line work`,
      unit: 'm',
      quantity: 100,
      rate: 10,
    }).select('id').single()).id as string;

    const woLineId = need('work order line', await svc.from('work_order_lines').insert({
      org_id: ORG_ID,
      work_order_id: woId,
      boq_item_id: boqId,
      quantity: 100,
    }).select('id').single()).id as string;

    // Validated progress worth 400.00 USD before today provides actual revenue to date.
    const nowIso = new Date().toISOString();
    reportId = need('validated site report', await svc.from('daily_site_reports').insert({
      org_id: ORG_ID,
      project_id: projectId,
      work_order_id: woId,
      work_date: inDays(-2),
      status: 'validated',
      author_id: ENGINEER_ID,
      submitted_at: nowIso,
      validated_by: pm.id,
      validated_at: nowIso,
    }).select('id').single()).id as string;

    ok('validated progress line', await svc.from('dsr_progress_lines').insert({
      org_id: ORG_ID,
      report_id: reportId,
      position: 1,
      work_order_line_id: woLineId,
      quantity: 40,
      unit: 'm',
      frozen_rate: 10,
      frozen_rate_source: 'contract',
      frozen_amount: 400,
      frozen_at: nowIso,
    }));

    // 1. Project manager supplies a dated revenue plan for last month (wholly in the past, so plan to date is the whole amount).
    await pm.signIn(page);
    await page.goto(`/work-orders/${woId}`);
    await openWorkOrderArea(page, 'cost');
    const pmSection = page.getByTestId('wo-page-revenue-plan');
    await expect(pmSection).toBeVisible({ timeout: 30_000 });
    await expect(pmSection.getByTestId('wo-revenue-plan-gap')).toHaveText('No plan entered');
    await pmSection.getByRole('button', { name: 'Enter plan', exact: true }).click();
    await page.locator('#wrp-month').selectOption({ index: 5 });
    await page.locator('#wrp-amount').fill('1000.00');
    await page.getByRole('button', { name: 'Save plan', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 });

    const expectedPlan = formatTableMoney('1000.00', 'USD') ?? 'unformattable';
    const expectedActual = formatTableMoney('400.00', 'USD') ?? 'unformattable';
    const expectedGap = formatTableMoney('600.00', 'USD') ?? 'unformattable';

    // 2. Project control manager reads plan to date, actual to date, and gap on both the work order and the project roll-up.
    await pcm.signIn(page);
    await page.goto(`/work-orders/${woId}`);
    await openWorkOrderArea(page, 'cost');
    const pcmSection = page.getByTestId('wo-page-revenue-plan');
    await expect(pcmSection).toBeVisible({ timeout: 30_000 });
    await expect(pcmSection.getByTestId('wo-revenue-plan-plan')).toHaveText(expectedPlan);
    await expect(pcmSection.getByTestId('wo-revenue-plan-actual')).toHaveText(expectedActual);
    await expect(pcmSection.getByTestId('wo-revenue-plan-gap')).toHaveText(`${expectedGap} behind plan`);

    await page.goto(`/projects/${projectId}/orders`);
    const row = page.getByTestId(`revenue-plan-row-${woId}`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText(expectedPlan);
    await expect(row).toContainText(expectedActual);
    await expect(row).toContainText(`${expectedGap} behind plan`);
  } finally {
    await cleanupAll(svc, [
      ['work_order_revenue_plan', 'work_order_id', woId ? [woId] : []],
      ['daily_site_reports', 'id', reportId ? [reportId] : []],
      ['work_order_lines', 'work_order_id', woId ? [woId] : []],
      ['boq_items', 'id', boqId ? [boqId] : []],
      ['work_orders', 'id', woId ? [woId] : []],
      ['projects', 'id', projectId ? [projectId] : []],
    ]);
    await pcm.cleanup();
    await pm.cleanup();
  }
});
