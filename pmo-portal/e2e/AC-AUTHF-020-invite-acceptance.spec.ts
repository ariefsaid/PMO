import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { clearMailpit, pollMailpitForAuthLink, requireServiceRoleKey } from './helpers';

// AC-AUTHF-020 — invite-acceptance round-trip (FR-AUTHF-030/031/032/034/035). Test setup stands in for
// GTM item 1a issuance: service-role inviteUserByEmail + user_metadata.invite_pending=true + a profiles
// row. Honest boundary (D6): service-role key from process.env; skip cleanly when absent.
const SERVICE_ROLE_KEY = requireServiceRoleKey();
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';

test.setTimeout(120_000);

test.skip(!SERVICE_ROLE_KEY, 'SERVICE_ROLE_KEY not set (local) — skipping');

test(
  'AC-AUTHF-020: invite link → /update-password → set password → signed in; gate clears',
  async ({ page }) => {
    const email = `invitee-${Date.now()}@example.com`;
    const password = 'InvitePass1!';
    const orgId = '00000000-0000-0000-0000-000000000001'; // seed org

    // --- Stand in for GTM item 1a issuance (service-role admin API) ---
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

    // 0. Clear Mailpit BEFORE the invite trigger (mirrors AC-AUTH-005: clear → trigger → poll). The invite
    //    email is the message under test — clearing inside the poll would wipe it.
    await clearMailpit();

    const { data: inviteData, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { invite_pending: true }, // §1.2 INVITE_PENDING contract (item 1a → this issue)
      // D1: an invite link resolves through the same recovery-token flow as a password reset, so it
      // must be redirectTo-routed at /update-password exactly like resetPasswordForEmail (AuthProvider's
      // requestPasswordReset) — otherwise GoTrue falls back to the bare site_url and the invitee never
      // reaches the acceptance page. The real GTM-item-1a issuance code must mirror this redirectTo.
      redirectTo: 'http://localhost:3000/update-password',
    });
    expect(inviteErr).toBeNull();
    const userId = inviteData!.user.id;
    // matching profiles row carrying role + org_id (§1.2 handshake)
    const { error: profileErr } = await admin.from('profiles').insert({
      id: userId,
      org_id: orgId,
      role: 'Project Manager',
      full_name: 'Invitee Test',
      email,
      company_id: null,
      avatar_url: null,
      title: null,
      location: null,
      skills: [],
      utilization: null,
    });
    expect(profileErr).toBeNull();
    try {
      // --- Acceptance surface (this issue) ---
      const link = await pollMailpitForAuthLink(email);
      await page.goto(link);
      await expect(page).toHaveURL(/\/update-password/);
      await expect(page.getByLabel(/new password/i)).toBeVisible();
      await page.getByLabel(/new password/i).fill(password);
      await page.getByLabel(/confirm password/i).fill(password);
      await page.getByRole('button', { name: /set new password/i }).click();
      await expect(page).toHaveURL(/\/$/); // FR-AUTHF-024/031
      // FR-AUTHF-035: the success updateUser cleared invite_pending → gate does NOT bounce a reload to /.
      await page.reload();
      await expect(page).toHaveURL(/\/$/);
      await expect(page).not.toHaveURL(/\/update-password/);
    } finally {
      // cleanup the test user + profile (service-role)
      await admin.from('profiles').delete().eq('id', userId);
      await admin.auth.admin.deleteUser(userId);
    }
  },
);
