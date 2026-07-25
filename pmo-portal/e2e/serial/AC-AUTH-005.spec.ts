// @e2e-isolation: serial — clears and polls the one process-global Mailpit inbox.
import { test, expect } from '@playwright/test';
import { clearMailpit, pollMailpitForAuthLink } from '../helpers';

// AC-AUTH-005 — Magic-link login completes via local inbox (FR-AUTH-022)
// Local email is captured by Mailpit (supabase email testing server, port 54324).
test('magic-link login completes via the local Mailpit inbox', async ({ page }) => {
  // Clear the mailbox so we read the freshest message for this run.
  await clearMailpit();

  await page.goto('/login');
  await page.getByLabel(/email/i).fill('engineer@acme.test');
  await page.getByRole('button', { name: /magic link/i }).click();
  await expect(page.getByRole('status')).toContainText(/check your email/i);

  // Poll Mailpit for the magic-link email addressed to the engineer. The
  // shared helper owns the full-suite delivery envelope and link parsing.
  const link = await pollMailpitForAuthLink('engineer@acme.test');

  await page.goto(link);
  // detectSessionInUrl consumes the token and clears the hash, landing on the dashboard.
  await expect(page.getByText('Tomas Beck')).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/);
});
