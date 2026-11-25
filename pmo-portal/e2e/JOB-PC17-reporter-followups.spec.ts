// @e2e-isolation: self-isolated — own tenant, issue type, department, project and job-role logins; owner cleanup removes its records.
import { test, expect } from '@playwright/test';
import { pickComboboxOption } from './helpers';
import { serviceClient, need } from './support/jobJourney';
import { createJobRoleUser, removeJobOrganization } from './support/jobRoleUser';

test.setTimeout(180_000);
test('JOB-PC17 Engineer reporter assigns cross-team follow-ups, records the cause and reads department closing time', async ({ page }) => {
  const db = serviceClient('JOB-PC17');
  const must = need('JOB-PC17');
  const org = must('organisation', await db.from('organizations').insert({ name: `Follow-ups ${crypto.randomUUID()}`, built_in_roles_enabled: true }).select('id').single());
  const reporter = await createJobRoleUser(db, org.id, 'engineer');
  const manager = await createJobRoleUser(db, org.id, 'project_manager');
  const administrator = await createJobRoleUser(db, org.id, 'administrator');
  try {
    // Admin setup: the report is enabled and the kept issue type is grouped under a department.
    must('report setting', await db.from('issue_closing_report_settings').upsert({ org_id: org.id, enabled: true, grouping_mode: 'department_groups' }).select('org_id'));
    must('issue type', await db.from('incident_types').insert({ org_id: org.id, label: 'Coordination' }).select('id'));
    must('department', await db.from('issue_department_groups').insert({ org_id: org.id, name: 'Engineering', issue_types: ['Coordination'] }).select('id'));
    const project = must('project', await db.from('projects').insert({ org_id: org.id, name: 'Coordination project', status: 'Ongoing Project', project_manager_id: manager.id }).select('id').single());
    await reporter.signIn(page);
    await page.goto(`/incidents?project=${project.id}`);
    await page.getByTestId('list-page-header').getByRole('button', { name: /file incident/i }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^type/i).selectOption({ label: 'Coordination' });
    await dialog.getByLabel(/severity/i).selectOption('Low');
    await dialog.getByLabel(/what must be done/i).fill('Coordinate the two teams');
    await pickComboboxOption(dialog, page, /person in charge/i, /Journey project_manager/);
    await dialog.getByRole('button', { name: /^file incident$/i }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('link', { name: /open Coordination/i }).click();
    const issueUrl = page.url();
    for (const [name, person] of [['Check design', 'Journey engineer'], ['Arrange access', 'Journey project_manager']]) {
      await page.getByTestId('incident-add-task').click();
      await page.getByRole('dialog').getByLabel(/^Task/).fill(name);
      await pickComboboxOption(page.getByRole('dialog'), page, /person in charge/i, new RegExp(person));
      await page.getByRole('dialog').getByRole('button', { name: 'Add a task' }).click();
      await expect(page.getByRole('link', { name })).toBeVisible();
    }
    await page.getByTestId('incident-root-cause-add').click();
    await page.getByLabel('Root cause').fill('Unclear handover');
    await page.getByTestId('incident-root-cause-save').click();
    await expect(page.getByTestId('incident-root-cause')).toContainText('Unclear handover');
    await expect(page.getByTestId('incident-advance')).toHaveCount(0);
    await page.goto('/my-tasks');
    await expect(page.getByRole('link', { name: 'Check design' })).toBeVisible();
    await manager.signIn(page);
    await page.goto('/my-tasks');
    await expect(page.getByRole('link', { name: 'Arrange access' })).toBeVisible();
    await page.goto(issueUrl);
    await page.getByTestId('incident-advance').click();
    await page.getByRole('dialog').getByRole('button', { name: /start investigating/i }).click();
    await expect(page.getByTestId('incident-pills')).toHaveAttribute('data-status', 'Investigating');
    await page.getByTestId('incident-advance').click();
    await page.getByRole('dialog').getByRole('button', { name: /close incident/i }).click();
    await expect(page.getByTestId('incident-pills')).toHaveAttribute('data-status', 'Closed');
    await reporter.signIn(page);
    await page.goto(issueUrl);
    await expect(page.getByRole('link', { name: 'Check design' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Arrange access' })).toBeVisible();
    await expect(page.getByTestId('incident-root-cause')).toContainText('Unclear handover');
    await page.goto('/incidents/closing-time');
    await page.getByLabel('Department grouping').selectOption('department_groups');
    const department = page.getByRole('row').filter({ hasText: 'Engineering' });
    await expect(department.getByRole('cell').nth(2)).toHaveText('1');
    await expect(department.getByRole('cell').nth(5)).toHaveText(/\d.*(min|hr|day)/i);
  } finally {
    removeJobOrganization(org.id);
    await administrator.remove();
    await manager.remove();
    await reporter.remove();
  }
});
