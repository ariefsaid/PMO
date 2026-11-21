// @e2e-isolation: serial — turns an organisation-wide setting on; cleanup restores it after the journey.
/**
 * AC-CLR-011 — the cleared-for-site checklist (#2707).
 * Goal oracle: an Admin turns the checklist on, defines an item, records it done for a person, and sees that person Cleared.
 */
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { signIn } from '../helpers';
import { need, ORG_ID, serviceClient } from '../support/jobJourney';

test.setTimeout(120_000);

const must = need('AC-CLR-011');
let admin: SupabaseClient | undefined;
let run = '';
let originalEnabled = false;

test.beforeEach(async () => {
  const client = serviceClient('AC-CLR-011 cleanup');
  admin = client;
  run = `E2E-CLR-${Date.now()}`;
  const org = must('setting baseline', await client.from('organizations').select('clearance_checklist_enabled').eq('id', ORG_ID).single());
  originalEnabled = (org as { clearance_checklist_enabled: boolean }).clearance_checklist_enabled;
});

test.afterEach(async () => {
  if (!admin) return;
  const failures: string[] = [];
  const { data: people } = await admin.from('people').select('id').eq('org_id', ORG_ID).like('name', `${run}%`);
  const ids = (people ?? []).map((p) => p.id as string);
  if (ids.length) {
    const { error } = await admin.from('person_clearances').delete().in('person_id', ids);
    if (error) failures.push(`cleanup states: ${error.message}`);
  }
  const { error: itemError } = await admin.from('clearance_items').delete().eq('org_id', ORG_ID).like('name', `${run}%`);
  if (itemError) failures.push(`cleanup items: ${itemError.message}`);
  const { error: personError } = await admin.from('people').delete().eq('org_id', ORG_ID).like('name', `${run}%`);
  if (personError) failures.push(`cleanup people: ${personError.message}`);
  const { error: settingError } = await admin.from('organizations').update({ clearance_checklist_enabled: originalEnabled }).eq('id', ORG_ID);
  if (settingError) failures.push(`restore setting: ${settingError.message}`);
  if (failures.length) throw new Error(`AC-CLR-011 ${failures.join('; ')}`);
});

test('AC-CLR-011: an Admin turns the checklist on, defines an item, records it for a person and sees them Cleared', async ({ page }) => {
  const personName = `${run} person`;
  const itemName = `${run} item`;
  must('seed person', await admin!.from('people').insert({ org_id: ORG_ID, name: personName }).select('id').single());
  await admin!.from('organizations').update({ clearance_checklist_enabled: false }).eq('id', ORG_ID);

  await signIn(page, 'admin@acme.test');
  await page.goto('/administration/people');
  await expect(page.getByRole('link', { name: 'Clearance' })).toHaveCount(0);
  await page.getByRole('switch', { name: 'Track who is cleared to go to site' }).click();
  await expect(page.getByRole('switch', { name: 'Track who is cleared to go to site' })).toHaveAttribute('aria-checked', 'true');

  await page.goto('/administration/clearance');
  await page.getByRole('button', { name: 'Add item' }).first().click();
  const form = page.getByRole('dialog');
  await form.getByLabel(/^Item name/).fill(itemName);
  await form.getByRole('button', { name: 'Save item' }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByText(itemName)).toBeVisible();

  await page.getByRole('link', { name: new RegExp(personName) }).click();
  await expect(page.getByText('Not cleared').first()).toBeVisible();
  await page.getByRole('button', { name: `Record ${itemName}` }).click();
  const state = page.getByRole('dialog');
  await state.getByRole('textbox', { name: /Date done/ }).fill(new Date().toISOString().slice(0, 10));
  await page.keyboard.press('Tab');
  await state.getByRole('button', { name: 'Save' }).click();
  await expect(state).toHaveCount(0);
  await expect(page.getByText('Cleared', { exact: true }).first()).toBeVisible();
});
