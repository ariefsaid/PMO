// @e2e-isolation: serial — enables the organisation-wide labour-cost switch and adds a run-scoped labour class and daily rate, restoring the prior switch state and removing/archiving owned rows in finally.
// JOB-PC21 (project control): guarding cost per day from unnamed head count. The project administrator enters a head count of three
// people under a daily-rated guard class, the project manager approves it, and the project control manager sees the work order's direct cost
// increase by three times the daily rate on the project orders screen.
import { test, expect } from '@playwright/test';
import { formatTableMoney } from '../../src/lib/format';
import { cleanupAll, need, ok, ORG_ID, runId, serviceClient } from '../support/jobFixtures';
import { inDays } from '../support/jobJourney';
import { roleJobUser } from '../support/roleJobUser';

test.setTimeout(180_000);

test('JOB-PC21 project administrator enters unnamed guard head count, project manager approves it, and project control manager sees the daily guarding cost on the work order', async ({ page }) => {
  const svc = serviceClient('JOB-PC21');
  const run = runId('JOBPC21');
  const fieldAdmin = await roleJobUser(svc, 'project_administrator', `${run}-fa`);
  const pm = await roleJobUser(svc, 'project_manager', `${run}-pm`);
  const pcm = await roleJobUser(svc, 'project_control_manager', `${run}-pcm`);

  let projectId = '';
  let woId = '';
  let crewId = '';
  let classId = '';
  let priorSetting: { enabled: boolean } | null = null;
  let hadSetting = false;

  try {
    const org = need('org currency', await svc.from('organizations').select('default_currency').eq('id', ORG_ID).single());
    const currency = (org.default_currency as string | null) ?? 'USD';

    const existing = await svc.from('labour_cost_settings').select('enabled').eq('org_id', ORG_ID).maybeSingle();
    if (existing.error) throw new Error(`labour_cost_settings read: ${existing.error.message}`);
    if (existing.data) {
      hadSetting = true;
      priorSetting = { enabled: Boolean(existing.data.enabled) };
    }
    ok('enable labour cost', await svc.from('labour_cost_settings').upsert({ org_id: ORG_ID, enabled: true }));

    projectId = need('project', await svc.from('projects').insert({
      org_id: ORG_ID,
      name: `${run} project`,
      status: 'Ongoing Project',
      currency,
      project_manager_id: pm.id,
    }).select('id').single()).id as string;

    woId = crypto.randomUUID();
    ok('work order', await svc.from('work_orders').insert({
      id: woId,
      org_id: ORG_ID,
      project_id: projectId,
      title: `${run} perimeter watch`,
      status: 'Issued',
      wo_number: `WO-${run}`,
      issued_at: new Date().toISOString(),
      order_value: 50_000,
      tax_treatment: 'exclusive',
      tax_amount: 0,
      currency,
    }));

    // Crew field_controller_id is set to the PM (not fieldAdmin) to verify the project_administrator role right (migration 2046).
    crewId = need('crew', await svc.from('crews').insert({
      org_id: ORG_ID,
      code: run.slice(-18),
      name: `${run} watch crew`,
      kind: 'own',
      field_controller_id: pm.id,
    }).select('id').single()).id as string;

    ok('roster', await svc.from('work_order_crews').insert({
      org_id: ORG_ID,
      work_order_id: woId,
      crew_id: crewId,
      valid_from: inDays(-7),
    }));

    const className = `Site guard ${run}`;
    const classCode = `grd_${run.toLowerCase().replace(/[^a-z0-9]/g, '').slice(-16)}`;
    classId = need('labour class', await svc.from('labour_cost_classes').insert({
      org_id: ORG_ID,
      code: classCode,
      name: className,
    }).select('id').single()).id as string;

    ok('daily class rate', await svc.from('labour_cost_rates').insert({
      org_id: ORG_ID,
      subject_kind: 'class',
      class_id: classId,
      basis: 'daily',
      amount: 150,
      overtime_multiplier: 1,
      day_hours: 8,
      month_hours: 173,
      effective_from: '2020-01-01',
    }));

    // 1. Project administrator records a head count of 3 unnamed guards for the work order.
    await fieldAdmin.signIn(page);
    await page.goto(`/crews?view=attendance&wo=${woId}`);
    await expect(page.getByText('No head count for this day')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('combobox', { name: 'Labour class' }).selectOption({ label: className });
    await page.getByRole('textbox', { name: 'Number of people' }).fill('3');
    await page.getByRole('button', { name: 'Save head count' }).click();

    const faRow = page.getByRole('row', { name: className });
    await expect(faRow).toContainText('3', { timeout: 20_000 });
    await expect(faRow).toContainText('Waiting for approval');
    // Project administrator records head count but never approves it.
    await expect(faRow.getByRole('button', { name: 'Approve' })).toHaveCount(0);

    // 2. Project manager approves the head count line.
    await pm.signIn(page);
    await page.goto(`/crews?view=attendance&wo=${woId}`);
    const pmRow = page.getByRole('row', { name: className });
    await expect(pmRow).toContainText('Waiting for approval', { timeout: 30_000 });
    await pmRow.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByRole('row', { name: className })).toContainText('Approved', { timeout: 20_000 });

    // 3. Project control manager confirms the work order's direct cost reflects 3 guards x 150/day = 450.00.
    const expectedCost = formatTableMoney('450.00', currency) ?? 'unformattable';
    await pcm.signIn(page);
    await page.goto(`/projects/${projectId}/orders`);
    const pvaRow = page.getByTestId(`wo-pva-row-${woId}`);
    await expect(pvaRow).toBeVisible({ timeout: 30_000 });
    await expect(pvaRow.getByTestId('wo-pva-direct')).toContainText(expectedCost);

    await pvaRow.getByRole('link', { name: /details/i }).click();
    const labour = page.getByTestId(`wo-pva-labour-${woId}`);
    await expect(labour).toBeVisible({ timeout: 20_000 });
    await expect(labour).toContainText(expectedCost);
  } finally {
    await cleanupAll(svc, [
      ['headcount_days', 'work_order_id', woId ? [woId] : []],
      ['work_order_crews', 'work_order_id', woId ? [woId] : []],
      ['crews', 'id', crewId ? [crewId] : []],
      ['labour_cost_rates', 'class_id', classId ? [classId] : []],
    ]);
    if (classId) {
      ok('archive labour class', await svc.from('labour_cost_classes').update({ archived_at: new Date().toISOString() }).eq('id', classId));
    }
    await cleanupAll(svc, [
      ['work_orders', 'id', woId ? [woId] : []],
      ['projects', 'id', projectId ? [projectId] : []],
    ]);
    if (hadSetting && priorSetting) {
      ok('restore labour cost setting', await svc.from('labour_cost_settings').upsert({ org_id: ORG_ID, enabled: priorSetting.enabled }));
    } else if (!hadSetting) {
      ok('remove labour cost setting', await svc.from('labour_cost_settings').delete().eq('org_id', ORG_ID));
    }
    await pcm.cleanup();
    await pm.cleanup();
    await fieldAdmin.cleanup();
  }
});
