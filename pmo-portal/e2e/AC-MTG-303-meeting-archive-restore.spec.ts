// @e2e-isolation: self-isolated — creates a uniquely named meeting and guest, then removes only those rows with service-role cleanup.
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { requireServiceRoleKey, signIn, waitForFonts } from './helpers';

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';

test.setTimeout(90_000);

let meetingTitle = '';

test.afterEach(async () => {
  if (!meetingTitle) return;
  const key = requireServiceRoleKey();
  if (!key) return;
  const admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  const { data: meetings, error: lookupError } = await admin.from('meetings').select('id').eq('title', meetingTitle);
  if (lookupError) throw lookupError;
  const ids = (meetings ?? []).map((meeting) => meeting.id);
  if (ids.length) {
    const { error: tasksError } = await admin.from('tasks').delete().in('meeting_id', ids);
    if (tasksError) throw tasksError;
    const { error: grantsError } = await admin.from('meeting_access_grants').delete().in('meeting_id', ids);
    if (grantsError) throw grantsError;
    const { error: attendeesError } = await admin.from('meeting_attendees').delete().in('meeting_id', ids);
    if (attendeesError) throw attendeesError;
    const { error: meetingsError } = await admin.from('meetings').delete().in('id', ids);
    if (meetingsError) throw meetingsError;
  }
  meetingTitle = '';
});

test('AC-MTG-303: an author can restore an archived meeting and keep its minutes and guest', async ({ page }) => {
  const suffix = randomUUID().slice(0, 8);
  meetingTitle = `Restore meeting ${suffix}`;
  const guestName = `Guest ${suffix}`;
  const minutesText = `Restored details ${suffix}`;

  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, 'engineer@acme.test');
  await page.goto('/meetings');
  await page.getByTestId('list-page-header').getByRole('button', { name: 'New meeting' }).click();
  await page.waitForURL('**/meetings/new');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill(meetingTitle);
  await page.getByRole('textbox', { name: 'External guest', exact: true }).fill(guestName);

  const editor = page.getByTestId('minutes-blocknote').locator('.bn-editor');
  await waitForFonts(page);
  await editor.click();
  await expect(editor).toBeFocused();
  await page.keyboard.type(minutesText);
  await page.getByRole('button', { name: 'Save meeting' }).click();
  await expect(page).toHaveURL(/\/meetings\/[0-9a-f-]{36}$/i, { timeout: 15_000 });
  await expect(page.getByTestId('record-header')).toContainText(meetingTitle);
  await expect(page.getByTestId('minutes-blocknote')).toContainText(minutesText);
  await expect(page.getByTestId('attendees-list')).toContainText(guestName);

  await page.getByTestId('meeting-archive').click();
  const archiveDialog = page.getByRole('dialog');
  await expect(archiveDialog).toBeVisible();
  await archiveDialog.getByRole('button', { name: 'Archive meeting' }).click();
  await expect(page).toHaveURL(/\/meetings$/);
  const openMeeting = page.getByRole('button', { name: `Open ${meetingTitle}` });
  await expect(openMeeting).toHaveCount(0);

  await page.getByRole('switch', { name: 'Show archived' }).click();
  const archivedRow = page.getByRole('row').filter({ has: page.getByRole('button', { name: `Open ${meetingTitle}` }) });
  await expect(archivedRow.getByText('Archived')).toBeVisible({ timeout: 15_000 });
  await archivedRow.getByRole('button', { name: 'Row actions' }).click();
  await page.getByRole('menuitem', { name: 'Restore' }).click();
  await expect(archivedRow.getByText('Archived')).toHaveCount(0, { timeout: 15_000 });

  await page.getByRole('switch', { name: 'Show archived' }).click();
  await expect(page).toHaveURL(/\/meetings$/);
  await page.getByRole('button', { name: `Open ${meetingTitle}` }).click();
  await expect(page.getByTestId('record-header')).toContainText(meetingTitle);
  await expect(page.getByTestId('minutes-blocknote')).toContainText(minutesText, { timeout: 15_000 });
  await expect(page.getByTestId('attendees-list')).toContainText(guestName, { timeout: 15_000 });

});
