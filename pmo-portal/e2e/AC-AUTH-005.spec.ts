// @e2e-isolation: read-only — magic-link login + nav assertion; reads Mailpit (no DB writes).
import { test, expect, request } from '@playwright/test';

// AC-AUTH-005 — Magic-link login completes via local inbox (FR-AUTH-022)
// Local email is captured by Mailpit (supabase email testing server, port 54324).
const MAILPIT = 'http://127.0.0.1:54324';

test('magic-link login completes via the local Mailpit inbox', async ({ page }) => {
  // Clear the mailbox so we read the freshest message for this run.
  const api = await request.newContext();
  await api.delete(`${MAILPIT}/api/v1/messages`);

  await page.goto('/login');
  await page.getByLabel(/email/i).fill('engineer@acme.test');
  await page.getByRole('button', { name: /send magic link/i }).click();
  await expect(page.getByRole('status')).toContainText(/check your email/i);

  // Poll Mailpit for the magic-link email addressed to the engineer.
  let link: string | null = null;
  await expect
    .poll(
      async () => {
        const listRes = await api.get(`${MAILPIT}/api/v1/messages`);
        const list = await listRes.json();
        const msg = (list.messages ?? []).find((m: { To: { Address: string }[] }) =>
          m.To?.some((t) => t.Address === 'engineer@acme.test')
        );
        if (!msg) return false;
        const bodyRes = await api.get(`${MAILPIT}/api/v1/message/${msg.ID}`);
        const body = await bodyRes.json();
        const text: string = `${body.Text ?? ''}\n${body.HTML ?? ''}`;
        const match = text.match(/https?:\/\/[^\s"'<>]*(?:verify|token|magiclink|otp)[^\s"'<>]*/i);
        link = match ? match[0].replace(/&amp;/g, '&') : null;
        return Boolean(link);
      },
      { timeout: 15_000, intervals: [500, 1000, 1500] }
    )
    .toBeTruthy();

  await page.goto(link!);
  // detectSessionInUrl consumes the token and clears the hash, landing on the dashboard.
  await expect(page.getByText('Tomas Beck')).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/);
});
