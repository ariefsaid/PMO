// @e2e-isolation: self-isolated — creates its own deal (service-role insert) and deletes it afterwards.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { signIn, requireServiceRoleKey, openPipelineCard } from './helpers';

const ORG_ID = '00000000-0000-0000-0000-000000000001';
// The seed org keeps the column default timezone (0198_locale_preference_columns.sql:24). Every date below is a
// calendar day in that zone, the same one the server's native_org_today uses — never a UTC day.
const ORG_TZ = 'Asia/Jakarta';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const svcKey = requireServiceRoleKey();
if (!svcKey) throw new Error('AC-PSH-016: SUPABASE_SERVICE_ROLE_KEY is required for this owning journey.');
const admin = createClient(SUPABASE_URL, svcKey, { auth: { persistSession: false } });

const ID = randomUUID();
const NAME = `PSH journey ${ID.slice(0, 8)}`;
const orgDay = (daysAgo: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: ORG_TZ }).format(new Date(Date.now() - daysAgo * 86_400_000));
const orgDayMonth = (daysAgo: number) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: ORG_TZ, day: '2-digit', month: 'short' })
    .format(new Date(Date.now() - daysAgo * 86_400_000));

test.beforeAll(async () => {
  const { error } = await admin.from('projects').insert({
    id: ID, org_id: ORG_ID, name: NAME, status: 'Leads', created_at: new Date(Date.now() - 60 * 86_400_000).toISOString(),
  });
  if (error) throw new Error(`AC-PSH-016 seed failed: ${error.message}`);
  const { error: moveError } = await admin.from('projects').update({ status: 'PQ Submitted' }).eq('id', ID);
  if (moveError) throw new Error(`AC-PSH-016 seed move failed: ${moveError.message}`);
  const { error: dateError } = await admin.from('project_stage_entries').update({ entered_on: orgDay(30) })
    .eq('project_id', ID).eq('stage', 'PQ Submitted');
  if (dateError) throw new Error(`AC-PSH-016 seed date failed: ${dateError.message}`);
});
test.afterAll(async () => {
  await admin.from('record_changes').delete().eq('entity_id', ID);
  await admin.from('record_changes').delete().eq('parent_id', ID);
  await admin.from('projects').delete().eq('id', ID); // cascades the stage entries
});

test('AC-PSH-016: a PM advances a deal, backdates the new stage on the deal page, and the card line follows', async ({ page }) => {
  await signIn(page, 'pm@acme.test');
  await page.goto('/sales');
  await openPipelineCard(page, NAME);

  // Single click, no dialog (write policy AC-IXD-WP-004): the move is dated today.
  await page.getByRole('button', { name: /advance to/i }).click();
  const history = page.getByRole('list', { name: 'Stage history' });
  await expect(history.getByRole('listitem').first()).toContainText(`Quoted ${orgDayMonth(0)}`);

  await history.getByRole('listitem').first().getByRole('button', { name: 'Change date' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Stage date').fill(orgDay(12));
  await dialog.getByRole('button', { name: 'Save date' }).click();
  await expect(dialog).toBeHidden();
  await expect(history.getByRole('listitem').first()).toContainText(`Quoted ${orgDayMonth(12)}`);
  await expect(history.getByRole('listitem').first()).toContainText('Date changed');

  await page.goto('/sales');
  await expect(page.getByTestId(`stage-line-${ID}`)).toHaveText(`Quoted ${orgDayMonth(12)} · 12 d`);
});
