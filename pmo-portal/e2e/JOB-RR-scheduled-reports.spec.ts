// @e2e-isolation: self-isolated — owns a disposable organisation and its job-role users.
import { test, expect } from '@playwright/test';
import { serviceClient, need } from './support/jobFixtures';
import { createJobRoleUser, removeJobOrganization } from './support/jobRoleUser';

test('AC-RR-009 project administrator schedules a progress email', async ({ page }) => {
  const db = serviceClient('JOB-RR-reports');
  const org = need('org', await db.from('organizations').insert({ name: `Reports ${crypto.randomUUID()}`, built_in_roles_enabled: true }).select('id').single());
  const reporting = await createJobRoleUser(db, org.id, 'project_administrator');
  const manager = await createJobRoleUser(db, org.id, 'project_manager');
  try {
    await reporting.signIn(page);
    await page.goto('/administration/scheduled-reports');
    await expect(page.getByRole('heading', { name: 'Scheduled reports', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Add a scheduled report' }).click();
    const form = page.getByRole('form', { name: 'Scheduled report' });
    await form.getByLabel(/^Name/).fill('Morning progress');
    await form.getByRole('checkbox', { name: 'Journey project_manager' }).check();
    await form.getByRole('button', { name: 'Save report' }).click();
    await expect(page.getByText('Morning progress')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Morning progress')).toBeVisible();
  } finally {
    removeJobOrganization(org.id);
    await reporting.remove();
    await manager.remove();
  }
});
