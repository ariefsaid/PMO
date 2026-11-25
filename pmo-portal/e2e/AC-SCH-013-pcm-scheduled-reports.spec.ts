// @e2e-isolation: self-isolated — disposable organisation and job-role logins.
import { test, expect } from '@playwright/test';
import { serviceClient, need } from './support/jobFixtures';
import { createJobRoleUser, removeJobOrganization } from './support/jobRoleUser';

test.setTimeout(120_000);

test('AC-SCH-013 Project Control Manager creates and toggles a scheduled report for non-light org readers', async ({ page }) => {
  const db = serviceClient('AC-SCH-013');
  const org = need(
    'org',
    await db
      .from('organizations')
      .insert({
        name: `PCM reports ${crypto.randomUUID()}`,
        built_in_roles_enabled: true,
        pcm_scheduled_reports_enabled: true,
      })
      .select('id')
      .single(),
  );
  const pcm = await createJobRoleUser(db, org.id, 'project_control_manager');
  const manager = await createJobRoleUser(db, org.id, 'project_manager');
  const foreman = await createJobRoleUser(db, org.id, 'foreman');
  // A schedule an Admin created: the manager never sees it listed.
  need(
    'admin schedule',
    await db
      .from('scheduled_reports')
      .insert({ org_id: org.id, name: 'Admin owned report', kind: 'daily_progress', frequency: 'daily', send_time: '08:00', recipient_roles: ['Finance'], enabled: true })
      .select('id')
      .single(),
  );

  try {
    await pcm.signIn(page);
    await page.goto('/administration/scheduled-reports');

    await expect(page.getByRole('heading', { name: 'Scheduled reports' })).toBeVisible();
    await expect(page.getByRole('switch', { name: /Project Control Managers can schedule/i })).toHaveCount(0);

    await expect(page.getByText('No scheduled reports yet.')).toBeVisible();
    await expect(page.getByText('Admin owned report')).toHaveCount(0);

    await page.getByRole('button', { name: 'Add a scheduled report' }).click();
    const form = page.getByRole('form', { name: 'Scheduled report' });
    await form.getByLabel(/^Name/).fill('PCM morning progress');
    await expect(form.getByRole('checkbox', { name: 'Journey project_manager' })).toBeVisible();
    await expect(form.getByRole('checkbox', { name: 'Journey foreman' })).toHaveCount(0);

    await form.getByRole('checkbox', { name: 'Journey project_manager' }).check();
    await form.getByRole('button', { name: 'Save report' }).click();

    await expect(page.getByText('PCM morning progress')).toBeVisible();
    await page.getByRole('switch', { name: 'PCM morning progress' }).click();
    await expect(page.getByText('Off')).toBeVisible();

    await page.reload();
    await expect(page.getByText('PCM morning progress')).toBeVisible();
    await expect(page.getByRole('switch', { name: 'PCM morning progress' })).not.toBeChecked();
    await expect(page.getByText('Admin owned report')).toHaveCount(0);
  } finally {
    removeJobOrganization(org.id);
    await pcm.remove();
    await manager.remove();
    await foreman.remove();
  }
});
