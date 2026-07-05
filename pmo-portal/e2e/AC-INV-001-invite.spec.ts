import { test, expect, type Page } from '@playwright/test';
import { signIn } from './helpers';

/**
 * AC-INV-001  Administration › Users › Invite — real cross-stack journey (ops-admin-surface S7
 * capstone, ADR-0010). Covers FR-INV-004/005/006.
 *
 * Given an org-Admin signed in on /administration, when they click "Add user", fill a FRESH email +
 * role "Engineer" and submit, then:
 *   1. the `admin-invite-user` edge fn is invoked with that email (asserted by OBSERVING the live
 *      network response — the call is let through to the real stack, never stubbed), AND
 *   2. the directory shows the new user row within ~2s.
 *
 * Goal oracle: a `profiles` row exists (visible in the directory) with the new email, status active,
 * the caller's org, role "Engineer".
 *
 * SCOPE BOUNDARY: the invite-EMAIL/accept flow (Supabase GoTrue delivering the invite email + the
 * recipient setting a password) belongs to `auth-production-floor` and is explicitly OUT OF SCOPE —
 * this spec asserts ONLY "the edge fn was called with the email" + "the directory shows the new
 * profiles row". The email uses Date.now() for uniqueness so re-runs never collide with a prior
 * DUPLICATE_EMAIL.
 */

test.setTimeout(120_000);

/** Wait for the Users directory to finish its initial fetch (ListState loading marker gone). */
async function waitReady(page: Page) {
  await expect(page.getByTestId('liststate-loading')).not.toBeVisible({ timeout: 20_000 });
}

/**
 * Click "Send invite" and return the admin-invite-user edge-fn response. Arms the response waiter
 * BEFORE the click so the response is never missed. Returns the live Response — the caller asserts
 * on its status (and retries on a transient gateway 503, see the spec body).
 */
async function submitInvite(page: Page, dialog: ReturnType<Page['getByRole']>) {
  const edgeFnResponse = page.waitForResponse(
    (res) => res.url().includes('/functions/v1/admin-invite-user') && res.request().method() === 'POST',
    { timeout: 30_000 },
  );
  await dialog.getByRole('button', { name: /send invite/i }).click();
  return edgeFnResponse;
}

test(
  'AC-INV-001: an Admin invites a new user — the admin-invite-user edge fn is called with the email AND the directory shows the new active Engineer row (goal oracle)',
  async ({ page }) => {
    // Date.now() guarantees a fresh email each run (no DUPLICATE_EMAIL collision with prior runs).
    const email = `ac-inv-001-${Date.now()}@invite.test`;

    await signIn(page, 'admin@acme.test');
    await page.goto('/administration');
    await waitReady(page);

    // The "Add user" affordance (FR-INV-004/006) is visible to an Admin.
    await expect(page.getByRole('button', { name: /add user/i })).toBeVisible({ timeout: 10_000 });

    // Open the InviteFormModal.
    await page.getByRole('button', { name: /add user/i }).click();
    const inviteDialog = page.getByRole('dialog');
    await expect(inviteDialog).toBeVisible({ timeout: 8_000 });
    await expect(inviteDialog.getByText(/invite someone/i)).toBeVisible();

    // Fill the fresh email + pick the Engineer role, then arm the network oracle BEFORE submit.
    await inviteDialog.getByLabel(/email/i).fill(email);
    await inviteDialog.getByLabel(/role/i).selectOption('Engineer');

    // GOAL ORACLE 1 — the admin-invite-user edge fn is invoked with the email (OBSERVED, not stubbed:
    // the route handler lets the real call continue so the profiles row is actually created). We
    // capture the request body to assert the email was sent, and let the response through.
    let observedEmail: string | undefined;
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/functions/v1/admin-invite-user') && req.method() === 'POST') {
        try {
          const body = JSON.parse(req.postData() ?? '{}');
          observedEmail = body.email;
        } catch {
          /* ignore — the response oracle still carries the assertion */
        }
      }
    });

    // Submit, capturing the edge-fn response. A transient gateway 503 (edge runtime cold-start) is
    // retried — it is a pure infrastructure signal, never the function's own contract (401/400/200/
    // 403/502). The FE keeps the modal open on error and resets its loading state, so re-clicking
    // "Send invite" re-submits the same filled form. We retry on 503 ONLY; any other non-2xx fails
    // the test honestly with the real status code. (The primary fix for the 503 churn — Playwright
    // writing artifacts into the edge-runtime's watched tree — is the out-of-worktree `outputDir` in
    // playwright.config.ts; this retry is defence-in-depth for an occasional first-call cold-start.)
    let response = await submitInvite(page, inviteDialog);
    for (let attempt = 0; attempt < 4 && response.status() === 503; attempt++) {
      await page.waitForTimeout(2500);
      await expect(inviteDialog).toBeVisible({ timeout: 8_000 });
      response = await submitInvite(page, inviteDialog);
    }

    // The edge fn ran (2xx is success — issuance of the profiles row). Any other status is a REAL
    // failure surfaced honestly with the status code.
    expect(response.ok(), `admin-invite-user returned ${response.status()}`).toBeTruthy();
    // The request carried the email we entered (defensive — also observable via the response path).
    expect(observedEmail).toBe(email);

    // GOAL ORACLE 2 — the directory now shows the new user row with role "Engineer", status Active.
    // The react-query `useUsers` cache invalidates on the invite mutation's success; wait for the
    // row whose User cell carries the email (unique per user).
    const newRow = page.locator('table tbody tr').filter({ hasText: email });
    await expect(newRow).toBeVisible({ timeout: 15_000 });
    await expect(newRow.getByRole('cell', { name: 'Engineer', exact: true })).toBeVisible();
    await expect(newRow.getByText('Active')).toBeVisible();
  },
);
