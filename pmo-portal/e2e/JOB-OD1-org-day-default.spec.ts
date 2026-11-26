// @e2e-isolation: self-isolated — only a disposable project-manager login whose own timezone is set; nothing else is written.
/**
 * JOB-OD1 — a form opens on the ORGANISATION's day, whatever timezone the person set on their own profile (#2914).
 * The organisation is on Jakarta time. At 18:00 UTC on 25 Nov it is already 26 Nov in Jakarta and still 25 Nov in New York.
 * Goal oracle: the project manager who set New York time opens "Lend worker" and sees the lend starting on 26 Nov (the day the
 * server files the record under), not 25 Nov. Times they see elsewhere still follow their own timezone (unit-proven).
 */
import { test, expect } from '@playwright/test';
import { need, serviceClient } from './support/jobJourney';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(120_000);
const must = need('JOB-OD1');

test('JOB-OD1 a project manager on New York time opens a lend form on the organisation\'s day', async ({ page }) => {
  const db = serviceClient('JOB-OD1');
  const pm = await roleJobUser(db, 'project_manager', `od1-pm-${Date.now()}`);
  try {
    must('own timezone', await db.from('profiles').update({ timezone: 'America/New_York' }).eq('id', pm.id).select('id').single());
    await page.clock.install({ time: new Date('2026-11-25T18:00:00Z') });
    await pm.signIn(page);
    await page.goto('/crews');
    await page.getByTestId('crew-loans').getByRole('button', { name: 'Lend worker' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel(/^From/)).toHaveValue('26 Nov 2026');
  } finally {
    await pm.cleanup();
  }
});
