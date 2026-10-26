// @e2e-isolation: serial — mutates org-global state (see design 2026-07-11-e2e-parallel-isolation).
import { test, expect, type Page } from '@playwright/test';
import { login } from '../helpers';

/**
 * AC-AU-001  Administration › Users management — real user journey (binding BDD principle).
 *
 * Covers in one sequential Admin journey:
 *   AC-AU-001  the user directory loads for an Admin → "New user" CTA is visible
 *   AC-AU-003  edit a user's role → the high-impact confirm appears → the role pill updates
 *   AC-AU-004  assign a user's manager → the manager column updates
 *
 * Plus separate gate assertions:
 *   AC-AU-002a Executive sees a READ-ONLY directory (no "New user", no row actions)
 *   AC-AU-002b a non-admin/non-exec role (Engineer) reaching the route sees an Admin-only gate
 *
 * Roles: admin@acme.test (full management), exec@acme.test (read-only), engineer@acme.test (gate).
 * Seed (supabase/seed.sql): Erin Adebayo (Admin) / Mara Lindqvist (Exec) / Diego Salvatierra (PM) /
 *   Priya Ramanathan (Finance) / Tomas Beck (Engineer); Tomas→Diego manager chain. The journey
 *   edits Tomas (Engineer) so it never collides with another slice's fixtures, and restores BOTH
 *   his role AND his line manager at the end to keep the seed reusable.
 *
 * ⚑ RESTORE THE MANAGER, NOT JUST THE ROLE (2026-07-29). This spec used to restore only the role
 *   and leave `Tomas → Mara`. `transition_timesheet` authorises the assigned line manager
 *   EXCLUSIVELY, so from that moment on pm@ could no longer approve Tomas's seeded week: the row
 *   sat in pm@'s /approvals queue for the rest of the serial lane and took AC-IXD-TS-W5-3 down
 *   with it — green in isolation, red only in the full lane, i.e. only at a dev→main promote.
 *   Every mutation this journey makes to a SHARED seed row must be restored, and the restore must
 *   be ASSERTED (a silent restore failure re-arms the leak invisibly).
 *
 * RBAC authority: docs/design/rbac-visibility.md §J + the profiles_admin_write RLS policy (0002).
 */

test.setTimeout(120_000);

/** Wait for the Users directory to finish its initial fetch (ListState loading marker gone). */
async function waitReady(page: Page) {
  await expect(page.getByTestId('liststate-loading')).toHaveCount(0, { timeout: 20_000 });
}

/** The directory row whose User cell shows this person's email (unique per user). */
function userRow(page: Page, email: string) {
  return page.locator('table tbody tr').filter({ hasText: email });
}

async function openRowMenu(page: Page, row: ReturnType<typeof page.locator>) {
  await row.hover();
  await row.getByRole('button', { name: 'Row actions' }).click();
}

async function setUserRole(page: Page, email: string, role: string) {
  await openRowMenu(page, userRow(page, email));
  await page.getByRole('menuitem', { name: /edit role/i }).click();
  const editor = page.getByRole('dialog');
  await editor.getByLabel(/role/i).selectOption(role);
  await editor.getByRole('button', { name: /save role/i }).click();
  const confirmation = page.getByRole('dialog').getByRole('button', { name: /change role/i });
  if (await confirmation.count()) await confirmation.click();
  await expect(userRow(page, email).getByRole('cell', { name: role, exact: true })).toBeVisible({ timeout: 15_000 });
}

async function setUserManager(page: Page, email: string, manager: string) {
  await openRowMenu(page, userRow(page, email));
  await page.getByRole('menuitem', { name: /change manager/i }).click();
  const editor = page.getByRole('dialog');
  await editor.getByRole('combobox', { name: /manager/i }).click();
  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible({ timeout: 8_000 });
  await listbox.getByText(manager, { exact: true }).click();
  await editor.getByRole('button', { name: /save manager/i }).click();
  await expect(editor).not.toBeVisible({ timeout: 15_000 });
  await expect(userRow(page, email).getByRole('button', { name: manager, exact: true })).toBeVisible({ timeout: 15_000 });
}

/** Repair this journey's shared fixture if a prior interrupted run stopped before cleanup. */
async function ensureSeedEngineerState(page: Page, email: string, manager: string) {
  const row = userRow(page, email);
  if (await row.getByRole('cell', { name: 'Engineer', exact: true }).count() === 0) {
    await setUserRole(page, email, 'Engineer');
  }
  if (await row.getByRole('button', { name: manager, exact: true }).count() === 0) {
    await setUserManager(page, email, manager);
  }
}

// ── AC-AU-001 / AC-AU-003 / AC-AU-004 — full Admin management journey ──

test(
  'AC-AU-001 + AC-AU-003 + AC-AU-004: an Admin views the directory, changes a role (with confirm), and assigns a manager — goal oracle: the role pill and manager column reflect the changes',
  async ({ page }) => {
    const engineerEmail = 'engineer@acme.test'; // Tomas Beck
    const newManager = 'Mara Lindqvist'; // exec@acme.test, a valid manager candidate
    // The seeded chain this journey must hand back intact (see the ⚑ note in the file header).
    const seedManager = 'Diego Salvatierra'; // pm@acme.test — Tomas's line manager in seed.sql

    await login(page, 'admin@acme.test');
    await page.goto('/administration');
    await waitReady(page);
    await ensureSeedEngineerState(page, engineerEmail, seedManager);

    try {
    // ── Step 1: AC-AU-001 — directory loads, the invite affordance is visible for Admin ──
    // FR-INV-004/006 (S4): the interim "Copy invite instructions" clipboard workaround was replaced
    // with a real "Invite user" button → InviteFormModal → admin-invite-user edge fn. The deep invite
    // journey is covered by AC-INV-001; here we only assert the affordance exists for an Admin.
    await expect(page.getByRole('button', { name: /invite user/i })).toBeVisible({ timeout: 10_000 });
    const daveRow = userRow(page, engineerEmail);
    await expect(daveRow).toBeVisible({ timeout: 10_000 });
    // "Engineer" also appears in his title (Lead PV Engineer) — target the role
    // pill specifically via its own table cell (exact match excludes the User cell).
    await expect(daveRow.getByRole('cell', { name: 'Engineer', exact: true })).toBeVisible();

    // ── Step 2: AC-AU-003 — change Dave's role to Finance (high-impact confirm) ──
    await openRowMenu(page, daveRow);
    await page.getByRole('menuitem', { name: /edit role/i }).click();

    const roleDialog = page.getByRole('dialog');
    await expect(roleDialog).toBeVisible({ timeout: 8_000 });
    await roleDialog.getByLabel(/role/i).selectOption('Finance');
    await roleDialog.getByRole('button', { name: /save role/i }).click();

    // High-impact: a confirm appears naming the change before the write commits.
    const roleConfirm = page.getByRole('dialog');
    await expect(roleConfirm).toContainText(/role to Finance/i, { timeout: 8_000 });
    await roleConfirm.getByRole('button', { name: /change role/i }).click();

    // GOAL ORACLE: the row's role pill now reads Finance.
    await expect(userRow(page, engineerEmail).getByText('Finance')).toBeVisible({ timeout: 15_000 });

    // ── Step 3: AC-AU-004 — assign Tomas a manager (Mara Lindqvist) ──
    await openRowMenu(page, userRow(page, engineerEmail));
    await page.getByRole('menuitem', { name: /change manager/i }).click();

    const mgrDialog = page.getByRole('dialog');
    await expect(mgrDialog).toBeVisible({ timeout: 8_000 });
    await mgrDialog.getByRole('combobox', { name: /manager/i }).click();
    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible({ timeout: 8_000 });
    await listbox.getByText(newManager, { exact: true }).click();
    await mgrDialog.getByRole('button', { name: /save manager/i }).click();

    // GOAL ORACLE: the manager column for Tomas now shows Mara Lindqvist.
    await expect(mgrDialog).not.toBeVisible({ timeout: 15_000 });
    await expect(userRow(page, engineerEmail).getByRole('button', { name: newManager, exact: true })).toBeVisible({ timeout: 15_000 });
    } finally {
      await page.keyboard.press('Escape').catch(() => {});
      // Restore shared seed state even when an assertion fails part-way through the journey.
      await ensureSeedEngineerState(page, engineerEmail, seedManager);
    }
  },
);

// ── AC-AU-002a — Executive read-only directory ──

test(
  'AC-AU-002a gating: an Executive sees a read-only user directory — no invite CTA, no row actions',
  async ({ page }) => {
    await login(page, 'exec@acme.test');
    await page.goto('/administration');
    await waitReady(page);

    // Exec CAN see the directory…
    await expect(userRow(page, 'admin@acme.test')).toBeVisible({ timeout: 10_000 });
    // …but the management chrome is absent (not merely disabled). The "Invite user" invite affordance
    // (FR-INV-004) is Admin/Operator-only — an Executive never sees it.
    await expect(page.getByRole('button', { name: /invite user/i })).not.toBeVisible();
    await expect(page.getByRole('button', { name: /row actions/i })).not.toBeVisible();
    // and the directory's read-only explanation is shown. Matched on its full sentence: since #548
    // the org tax-default card on this page carries its own "Only an Admin can change this." note,
    // and a loose /only an Admin can/ resolved to both (strict-mode violation at the 2026-09-02
    // promote, #599). A locator that can resolve to N elements is not an oracle.
    await expect(
      page.getByText(/only an Admin can add, edit, or disable users/i),
    ).toBeVisible();
  },
);

// ── AC-AU-002b — non-admin/non-exec is gated out of the surface ──

test(
  'AC-AU-002b gating: an Engineer reaching /administration sees an Admin-only gate, not the directory',
  async ({ page }) => {
    await login(page, 'engineer@acme.test');
    await page.goto('/administration');

    // GOAL ORACLE: an Admin-only gate is shown and the directory rows are NOT rendered.
    // Copy since #676: "Administration is an Admin, Executive, or platform Operator area."
    await expect(
      page.getByText(/Administration is an Admin, Executive, or platform Operator area/i),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /invite user/i })).not.toBeVisible();
  },
);
