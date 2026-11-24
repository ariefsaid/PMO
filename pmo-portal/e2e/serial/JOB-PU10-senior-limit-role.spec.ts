// @e2e-isolation: serial — configures an org senior approver; deletes only its own approver entry and fixtures.
import { test, expect } from '@playwright/test';
import { moneyJobRole } from '../support/moneyJobRole';
import { serviceClient, need, ok, ORG_ID, PM_ID, ownProject, runId } from '../support/jobFixtures';

test('JOB-PU10 Finance Manager approves the proposed site-cash limit when configured as its senior approver', async ({ browser }) => {
  const db = serviceClient('float approval');
  const manager = await moneyJobRole('finance_manager', 'Finance');
  const outsider = await moneyJobRole('finance_manager', 'Finance');
  const project = await ownProject(db, runId('float-route'));
  let floatId = '';
  try {
    // This is the senior-set configuration an Admin makes, without changing a shared user's role.
    ok('senior approver', await db.from('spend_approvers').insert({ org_id: ORG_ID, project_id: null, profile_id: manager.id }));
    floatId = need('float', await db.from('imprest_floats').insert({ org_id: ORG_ID, project_id: project, custodian_id: PM_ID, currency: 'USD', created_by: '00000000-0000-0000-0000-0000000000a3' }).select('id').single()).id;
    ok('proposed limit', await db.from('imprest_float_changes').insert({ org_id: ORG_ID, float_id: floatId, proposed_amount: 5000, proposed_by: '00000000-0000-0000-0000-0000000000a3' }));
    const otherContext = await browser.newContext();
    try {
      const otherPage = await otherContext.newPage();
      await outsider.login(otherPage); await otherPage.goto(`/imprest/${floatId}`);
      await expect(otherPage.getByTestId('limit-waiting-route')).toBeVisible();
      await expect(otherPage.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
      await expect(otherPage.getByRole('button', { name: 'Reject', exact: true })).toHaveCount(0);
    } finally { await otherContext.close(); }
    const context = await browser.newContext();
    try {
      const page = await context.newPage(); await manager.login(page); await page.goto(`/imprest/${floatId}`);
      await page.getByRole('button', { name: 'Approve', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Approve', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
      await expect(page.getByRole('cell', { name: 'Approved', exact: true })).toBeVisible();
      await expect(page.getByTestId('figure-float')).toContainText(/5[,.]000/);
    } finally { await context.close(); }
  } finally {
    if (floatId) { ok('changes', await db.from('imprest_float_changes').delete().eq('float_id', floatId)); ok('float', await db.from('imprest_floats').delete().eq('id', floatId)); }
    ok('senior row', await db.from('spend_approvers').delete().eq('profile_id', manager.id));
    ok('project', await db.from('projects').delete().eq('id', project));
    await manager.cleanup(); await outsider.cleanup();
  }
});
