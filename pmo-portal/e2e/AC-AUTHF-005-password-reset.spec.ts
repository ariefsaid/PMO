import { test, expect } from '@playwright/test';
import { clearMailpit, pollMailpitForAuthLink } from './helpers';

// AC-AUTHF-005 — password-reset round-trip via local Mailpit (FR-AUTHF-011/015/020/024).
test('AC-AUTHF-005: request reset → Mailpit → /update-password → set password → signed in with the new password', async ({
  page,
  browser,
}) => {
  const email = 'pm@acme.test';
  const newPassword = 'BrandNewPass1!';

  // 0. Clear Mailpit BEFORE the send action (mirrors AC-AUTH-005: clear → trigger → poll).
  await clearMailpit();

  // 1. Request the reset link.
  await page.goto('/reset-password');
  await page.getByLabel(/email/i).fill(email);
  await page.getByRole('button', { name: /send reset link/i }).click();
  await expect(page.getByRole('status')).toContainText(/check your email|reset link/i);

  // 2. Pull the link from Mailpit (inbox NOT cleared here) and follow it → /update-password set-password form.
  const link = await pollMailpitForAuthLink(email);
  expect(link).toMatch(/update-password|type=recovery|token=/i);
  await page.goto(link);
  await expect(page).toHaveURL(/\/update-password/);
  await expect(page.getByLabel(/new password/i)).toBeVisible();
  // FR-AUTHF-027: the token params were stripped from the URL after session establishment.
  await expect(page).not.toHaveURL(/[?&](token|refresh_token|type)=/);

  // 3. Set the new password → navigates to / signed in.
  await page.getByLabel(/new password/i).fill(newPassword);
  await page.getByLabel(/confirm password/i).fill(newPassword);
  await page.getByRole('button', { name: /set new password/i }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('Diego Salvatierra')).toBeVisible(); // PM persona

  // 4. The NEW password works on a fresh context; the OLD one no longer does.
  const fresh = await browser.newContext();
  const p2 = await fresh.newPage();
  await p2.goto('/login');
  await p2.getByLabel(/email/i).fill(email);
  await p2.getByLabel(/password/i).fill(newPassword);
  await p2.getByRole('button', { name: /sign in/i }).click();
  await expect(p2).toHaveURL(/\/$/);
  await fresh.close();

  const fresh2 = await browser.newContext();
  const p3 = await fresh2.newPage();
  await p3.goto('/login');
  await p3.getByLabel(/email/i).fill(email);
  await p3.getByLabel(/password/i).fill('Passw0rd!dev'); // old password
  await p3.getByRole('button', { name: /sign in/i }).click();
  await expect(p3.getByRole('alert')).toBeVisible();
  await fresh2.close();
});
