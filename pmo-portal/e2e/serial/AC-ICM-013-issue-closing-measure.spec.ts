// @e2e-isolation: serial — turns the closing-time report on for the org (org-global setting) and restores it afterwards.
import { test, expect } from '@playwright/test';
import { pickComboboxOption, signIn } from '../helpers';
import { cleanSiteIssue } from '../siteIssueFixture';
import { ENGINEER_ID, ORG_ID, PM_ID, need, serviceClient } from '../support/jobJourney';
import { seedWorkOrder } from '../support/crewJourney';

/**
 * AC-ICM-013 (issue-closing-measure): an Admin adds an issue type, a manager raises and closes an issue of it, and the closing-time
 * report shows the type's group with, beside it, the effective working hours of a work order with a validated daily report.
 * Goal oracle: the type is picked from the kept list (no free text), the report has a group under that type's label, and the
 * work order's day shows worked 8.5, stopped 2.0, effective 6.5 hours.
 */
test.setTimeout(240_000);
const db = serviceClient('AC-ICM-013');
const must = need('AC-ICM-013');
const run = `ICM-${Date.now()}`;
const type = `${run} type`;
let wo = { projectId: '', workOrderId: '', title: '' };
let priorSetting: { enabled: boolean; grouping_mode: string } | null = null;
const workDate = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);

test.beforeEach(async () => {
  wo = await seedWorkOrder(db, 'AC-ICM-013', run, 'plant');
  const prior = await db.from('issue_closing_report_settings').select('enabled, grouping_mode').eq('org_id', ORG_ID).maybeSingle();
  priorSetting = prior.data ?? null;
  must('enable report', await db.from('issue_closing_report_settings').upsert({ org_id: ORG_ID, enabled: true, grouping_mode: 'type' }, { onConflict: 'org_id' }).select().single());
  const reason = must('idle reason', await db.from('dsr_idle_reasons').select('id').eq('org_id', ORG_ID).limit(1).single());
  const report = must('report', await db.from('daily_site_reports').insert({
    org_id: ORG_ID, project_id: wo.projectId, work_order_id: wo.workOrderId, work_date: workDate, status: 'validated',
    author_id: ENGINEER_ID, validated_by: PM_ID, validated_at: new Date().toISOString(), start_time: '08:00', end_time: '16:30',
  }).select('id').single());
  must('idle', await db.from('dsr_idle_periods').insert({ org_id: ORG_ID, report_id: report.id, position: 1, minutes: 120, reason_id: reason.id }).select().single());
});
test.afterEach(async () => {
  await cleanSiteIssue(type);
  if (priorSetting) await db.from('issue_closing_report_settings').update(priorSetting).eq('org_id', ORG_ID);
  else await db.from('issue_closing_report_settings').delete().eq('org_id', ORG_ID);
  await db.from('daily_site_reports').delete().eq('work_order_id', wo.workOrderId);
  await db.from('work_orders').delete().eq('id', wo.workOrderId);
  await db.from('projects').delete().eq('id', wo.projectId);
});

test('AC-ICM-013: a listed type, closed issues grouped by it, and effective hours beside the closing time', async ({ page }) => {
  // The Admin adds the type on the Administration card.
  await signIn(page, 'admin@acme.test');
  await page.goto('/administration/projects');
  const card = page.getByRole('region', { name: 'Issue types' });
  await card.getByLabel('New issue type').fill(type);
  await card.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(card.getByText(type, { exact: true })).toBeVisible();

  // A manager raises an issue: the type is a pick from the list, not free text.
  await signIn(page, 'pm@acme.test');
  await page.goto(`/incidents?project=${wo.projectId}`);
  await page.getByRole('button', { name: /file incident/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel(/^type/i)).toHaveJSProperty('tagName', 'SELECT');
  await dialog.getByLabel(/^type/i).selectOption({ label: type });
  await dialog.getByLabel(/severity/i).selectOption('Low');
  await dialog.getByRole('button', { name: /^file incident$/i }).click();
  await page.getByRole('link', { name: new RegExp(`open ${type}`, 'i') }).click();
  await page.getByTestId('incident-advance').click();
  await page.getByRole('dialog').getByRole('button', { name: /start investigating/i }).click();
  await expect(page.getByTestId('incident-pills')).toHaveAttribute('data-status', 'Investigating', { timeout: 20_000 });
  await page.getByTestId('incident-advance').click();
  await page.getByRole('dialog').getByRole('button', { name: /close incident/i }).click();
  await expect(page.getByTestId('incident-pills')).toHaveAttribute('data-status', 'Closed', { timeout: 20_000 });

  // The closing-time report groups by the type's label, with the effective hours of the work order beside it.
  await page.goto('/incidents/closing-time');
  await page.getByTestId('preset-all').click();
  await expect(page.getByTestId('closing-time-report')).toContainText(type, { timeout: 20_000 });
  await page.getByTestId('preset-90d').click();
  const panel = page.getByTestId('effective-hours-panel');
  await pickComboboxOption(panel, page, /^Project/, new RegExp(run));
  await pickComboboxOption(panel, page, /^Work order/);
  const table = panel.getByTestId('effective-hours-table');
  await expect(table).toContainText('8.5');
  await expect(table).toContainText('2.0');
  await expect(table).toContainText('6.5');
});
