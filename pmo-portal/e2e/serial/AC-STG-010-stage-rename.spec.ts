// @e2e-isolation: serial — renames an organisation-wide sales stage and restores it afterward.
import { test, expect } from '@playwright/test';
import { login, pickComboboxOption, stubErpProjectSync } from '../helpers';
import { ORG_ID, need, serviceClient } from '../support/jobJourney';

test('AC-STG-010: an Admin renames a stage and the sales lead works the board under the new name', async ({ browser }) => {
  test.setTimeout(120_000);
  const db = serviceClient('AC-STG-010');
  const ok = need('AC-STG-010');
  const before = ok('read the stage', await db.from('pipeline_stage_config').select('label_en, label_id')
    .eq('org_id', ORG_ID).eq('status', 'Quotation Submitted').single());
  const deal = `Stage rename deal ${Date.now()}`;
  try {
    const admin = await browser.newPage();
    await login(admin, 'admin@acme.test');
    await admin.goto('/administration/projects');
    const stageNames = admin.getByRole('region', { name: 'Sales and project stages' });
    await stageNames.getByLabel('Quotation submitted, English name').fill('Proposal sent');
    await stageNames.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(admin.getByText('Stage names saved').first()).toBeVisible();
    await admin.close();

    const pm = await browser.newPage();
    await stubErpProjectSync(pm);
    await login(pm, 'pm@acme.test');
    await pm.goto('/projects');
    await pm.getByRole('button', { name: /new project/i }).first().click();
    await pm.getByLabel(/project name/i).fill(deal);
    await pickComboboxOption(pm, pm, /client company/i, /^Meridian Steelworks/);
    await pm.getByRole('button', { name: /^Create project$/i }).click();
    await expect(pm).toHaveURL(/\/projects\/[0-9a-f-]{36}$/u);

    await pm.getByRole('button', { name: 'Advance to Proposal sent' }).click();
    await expect(pm.getByText('Moved to Proposal sent').first()).toBeVisible();

    await pm.goto('/sales');
    await expect(pm.getByTestId('stage-Quotation Submitted')).toContainText('Proposal sent');
    await expect(pm.getByTestId('stage-Quotation Submitted')).toContainText(deal);
  } finally {
    ok('restore the stage', await db.from('pipeline_stage_config').update(before)
      .eq('org_id', ORG_ID).eq('status', 'Quotation Submitted').select('status'));
    const removed = await db.from('projects').delete().eq('org_id', ORG_ID).eq('name', deal);
    expect(removed.error).toBeNull();
  }
});
