// @e2e-isolation: serial — turns the organisation-wide clearance checklist on for the run and restores it in afterAll; owns its HR login, person and checklist items.
// JOB-H2 (acceptance 07-people-and-admin, TC-PA-02): clearing a person for site. The HR Officer opens Administration →
// Clearance → the person, records papers and medical with a date each; two items read Done, the rest Not done, and the
// person still reads Not cleared.
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { need, ORG_ID, runId, serviceClient } from '../support/jobFixtures';
import { orgToday } from '../support/jobJourney';
import { roleJobUser } from '../support/roleJobUser';

test.setTimeout(120_000);

let svc: SupabaseClient;
let originalEnabled = false;
test.beforeAll(async () => {
  svc = serviceClient('JOB-H2');
  originalEnabled = need('setting baseline', await svc.from('organizations').select('clearance_checklist_enabled').eq('id', ORG_ID).single()).clearance_checklist_enabled as boolean;
  need('setting on', await svc.from('organizations').update({ clearance_checklist_enabled: true }).eq('id', ORG_ID).select('id').single());
});
test.afterAll(async () => {
  need('setting restored', await svc.from('organizations').update({ clearance_checklist_enabled: originalEnabled }).eq('id', ORG_ID).select('id').single());
});

test('JOB-H2 the HR Officer records papers and medical for a person: two items Done, the rest Not done, the person Not cleared', async ({ page }) => {
  const run = runId('JOBH2');
  const hr = await roleJobUser(svc, 'hr_officer', run);
  const names = { papers: `${run} papers`, medical: `${run} medical`, induction: `${run} induction` };
  let personId = '';
  try {
    personId = need('person', await svc.from('people').insert({ org_id: ORG_ID, name: `${run} person` }).select('id').single()).id as string;
    need('items', await svc.from('clearance_items').insert(Object.values(names).map((name, i) => ({ org_id: ORG_ID, name, sort_order: i }))).select('id'));

    await hr.signIn(page);
    await page.goto('/administration/clearance');
    await page.getByRole('link', { name: new RegExp(`${run} person`) }).click();
    await expect(page.getByRole('heading', { name: 'Cleared-for-site checklist' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Not cleared').first()).toBeVisible();

    for (const name of [names.papers, names.medical]) {
      await page.getByRole('button', { name: `Record ${name}` }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('textbox', { name: /Date done/ }).fill(orgToday());
      await page.keyboard.press('Tab');
      await dialog.getByRole('button', { name: 'Save' }).click();
      await expect(dialog).toHaveCount(0);
    }

    const row = (name: string) => page.getByRole('listitem').filter({ hasText: name });
    await expect(row(names.papers).getByText('Done', { exact: true })).toBeVisible();
    await expect(row(names.medical).getByText('Done', { exact: true })).toBeVisible();
    await expect(row(names.induction).getByText('Not done', { exact: true })).toBeVisible();
    await expect(page.getByText('Done', { exact: true })).toHaveCount(2);
    await expect(page.getByText('Not done', { exact: true })).toHaveCount(1);
    await expect(page.getByText('Not cleared').first()).toBeVisible();
  } finally {
    if (personId) {
      await svc.from('person_clearances').delete().eq('person_id', personId);
      await svc.from('people').delete().eq('id', personId);
    }
    await svc.from('clearance_items').delete().eq('org_id', ORG_ID).like('name', `${run}%`);
    await hr.cleanup();
  }
});
