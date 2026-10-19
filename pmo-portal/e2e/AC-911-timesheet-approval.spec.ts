// @e2e-isolation: dedicated-row — owns Grace (ts-approve-eng@) + Heidi (ts-approve-mgr@) dedicated seed actors + Grace's dedicated timesheet; no other spec mutates them.
import { createClient } from '@supabase/supabase-js';
import { test, expect } from '@playwright/test';
import { login, requireServiceRoleKey } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

// AC-911 — real Submit → Approve happy path across two users.
// The sequential tests below share only Grace's dedicated seeded sheet; the submit and approval RPCs
// remain real UI actions by two separate actors. The serial describe preserves the state dependency.
//
// ISOLATION: Grace (b1, Engineer) reports to Heidi (b2, PM), and the seeded sheet is dedicated to
// AC-911. Preparation resets only that exact row; the browser clock uses its stored week so the
// reset-time seed date does not go stale between local DB resets.
// The fixture is refused if it has an ERP mirror or outbox command, because those carry independent
// money state that this browser journey must not rewrite.
//
// NOTE (feat/ui-polish confirm-gate): BOTH the Submit and the Approve actions are confirm-gated via
// ConfirmDialog. Keep each action's dialog confirmation and post-state oracle in its owning test.
//
// (FR-TS-001/004/005/008/011, NFR-TS-UI-001, plan Phase E3)

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const AUTHOR_ID = '00000000-0000-0000-0000-0000000000b1';
const FIXTURE_ID = '70000000-0000-0000-0000-0000000000b1';

function requireAc911ServiceKey(): string {
  const serviceKey = requireServiceRoleKey();
  if (!serviceKey) {
    throw new Error('AC-911 requires the service-role client supplied by scripts/e2e-local.sh or CI.');
  }
  return serviceKey;
}

const SERVICE_KEY = requireAc911ServiceKey();
const SUPABASE_URL = requireMatchingLocalSupabaseUrls(process.env.SUPABASE_URL, process.env.VITE_SUPABASE_URL);
let fixtureWeekStartDate = '';

if (!SUPABASE_URL) {
  throw new Error('AC-911 requires SUPABASE_URL supplied by scripts/e2e-local.sh or CI.');
}

/** Restore only AC-911's seeded row to its starting state; never reset the shared database. */
async function prepareDedicatedDraftFixture() {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: fixture, error: fixtureError } = await admin
    .from('timesheets')
    .select('id, status, week_start_date')
    .eq('id', FIXTURE_ID)
    .eq('org_id', ORG_ID)
    .eq('user_id', AUTHOR_ID)
    .maybeSingle();

  if (fixtureError) throw new Error(`AC-911 dedicated fixture lookup failed: ${fixtureError.message}`);
  if (!fixture) {
    throw new Error('AC-911 dedicated seeded timesheet is missing; this spec will not create or substitute another row.');
  }
  if (!fixture.week_start_date) {
    throw new Error('AC-911 dedicated seeded timesheet has no week_start_date.');
  }
  fixtureWeekStartDate = fixture.week_start_date;

  const [mirrorResult, outboxResult] = await Promise.all([
    admin.from('timesheet_erp_mirror').select('timesheet_id').eq('timesheet_id', FIXTURE_ID),
    admin
      .from('external_command_outbox')
      .select('id')
      .eq('org_id', ORG_ID)
      .eq('domain', 'timesheets')
      .eq('pmo_record_id', FIXTURE_ID),
  ]);
  if (mirrorResult.error) throw new Error(`AC-911 mirror check failed: ${mirrorResult.error.message}`);
  if (outboxResult.error) throw new Error(`AC-911 outbox check failed: ${outboxResult.error.message}`);
  if ((mirrorResult.data?.length ?? 0) > 0 || (outboxResult.data?.length ?? 0) > 0) {
    throw new Error('AC-911 dedicated fixture has ERP-linked state and cannot be safely prepared by this spec.');
  }

  const { data: prepared, error: prepareError } = await admin
    .from('timesheets')
    .update({ status: 'Draft', submitted_at: null, approved_by: null, approved_at: null })
    .eq('id', FIXTURE_ID)
    .eq('org_id', ORG_ID)
    .eq('user_id', AUTHOR_ID)
    .select('id, status')
    .maybeSingle();

  if (prepareError) throw new Error(`AC-911 dedicated fixture preparation failed: ${prepareError.message}`);
  if (!prepared || prepared.id !== FIXTURE_ID || prepared.status !== 'Draft') {
    throw new Error('AC-911 dedicated fixture preparation did not restore the exact row to Draft.');
  }
}

test.describe('AC-911: a dedicated sheet is submitted by its owner, then approved by the line manager', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeAll(prepareDedicatedDraftFixture);

  test('AC-911 owner submits the dedicated Draft sheet and sees Submitted', async ({ page }) => {
    // ── Grace (owner) submits her Draft sheet ────────────────────────────────
    await login(page, 'ts-approve-eng@acme.test');
    await page.clock.setFixedTime(new Date(`${fixtureWeekStartDate}T12:00:00.000Z`));
    await page.goto('/timesheets');

    // Wait for loading skeleton to disappear (timesheets data loaded).
    await expect(page.getByTestId('timesheets-loading')).not.toBeVisible({ timeout: 15_000 });

    // The seeded Draft sheet is for the current week. Submit appears once the timesheets query
    // and currentUser profile have both resolved.
    const submitBtn = page.getByRole('button', { name: /submit timesheet/i });
    await expect(submitBtn).toBeVisible({ timeout: 20_000 });
    await expect(submitBtn).toBeEnabled();

    // Click the page-level Submit button — stages a ConfirmDialog (no write yet).
    await submitBtn.click();

    // Confirm inside the dialog (confirmLabel="Submit timesheet"). Scope to role="dialog".
    const submitDialog = page.getByRole('dialog');
    await expect(submitDialog).toBeVisible({ timeout: 5_000 });
    const submitConfirmBtn = submitDialog.getByRole('button', { name: /submit timesheet/i });
    await expect(submitConfirmBtn).toBeVisible();
    await submitConfirmBtn.click();

    // Wait for the dialog to close (real mutation committed, ConfirmDialog removed).
    await expect(submitDialog).not.toBeVisible({ timeout: 15_000 });

    // StatusPill shows exactly "Submitted" once the real RPC resolves.
    // exact:true avoids matching "Draft — not submitted" or the toast "Timesheet submitted".
    await expect(page.getByText('Submitted', { exact: true })).toBeVisible({ timeout: 15_000 });

    // Submit button should no longer be present (status is Submitted, not Draft).
    await expect(page.getByRole('button', { name: /submit timesheet/i })).not.toBeVisible({ timeout: 5_000 });
  });

  test('AC-911 line manager approves the submitted sheet and it leaves the approval queue', async ({ page }) => {
    // ── Heidi (line manager) approves Grace's Submitted sheet ─────────────────
    await login(page, 'ts-approve-mgr@acme.test');
    await page.clock.setFixedTime(new Date(`${fixtureWeekStartDate}T12:00:00.000Z`));
    // CW-6: a PM sees both approval modules as deep-linkable scope tabs; this test approves a
    // timesheet, so it deep-links straight to the timesheets scope (its canonical home).
    await page.goto('/approvals?scope=timesheets');

    // Wait for loading skeleton to disappear.
    await expect(page.getByTestId('approvals-loading')).not.toBeVisible({ timeout: 15_000 });

    // Grace's Submitted sheet should appear in Heidi's approval queue.
    // Scope to the approval row section to avoid strict-mode issues with any dialog.
    const queue = page.locator('section');
    await expect(queue.getByText('Grace TSApprove').first()).toBeVisible({ timeout: 10_000 });

    // Click Approve for Grace's row — stages a ConfirmDialog (no write yet).
    await page.getByRole('button', { name: /^approve$/i }).first().click();

    // Confirm inside the dialog (confirmLabel="Approve" per ApprovalsQueue.tsx).
    const approveDialog = page.getByRole('dialog');
    await expect(approveDialog).toBeVisible({ timeout: 5_000 });
    const approveConfirmBtn = approveDialog.getByRole('button', { name: /^approve$/i });
    await expect(approveConfirmBtn).toBeVisible();
    await approveConfirmBtn.click();

    // Wait for the real approval mutation to close the dialog.
    await expect(approveDialog).not.toBeVisible({ timeout: 15_000 });

    // After approval, Grace's row should leave the queue (no matching row in the section).
    await expect(queue.getByText('Grace TSApprove').first()).not.toBeVisible({ timeout: 15_000 });
  });
});
