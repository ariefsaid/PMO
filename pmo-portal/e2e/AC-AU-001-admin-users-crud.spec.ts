import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

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
 *   edits Tomas (Engineer) so it never collides with another slice's fixtures, and restores his
 *   role at the end to keep the seed reusable.
 *
 * RBAC authority: docs/design/rbac-visibility.md §J + the profiles_admin_write RLS policy (0002).
 */

test.setTimeout(120_000);

/** Wait for the Users directory to finish its initial fetch (ListState loading marker gone). */
async function waitReady(page: Page) {
  await expect(page.getByTestId('liststate-loading')).not.toBeVisible({ timeout: 20_000 });
}

/** The directory row whose User cell shows this person's email (unique per user). */
function userRow(page: Page, email: string) {
  return page.locator('table tbody tr').filter({ hasText: email });
}

async function openRowMenu(page: Page, row: ReturnType<typeof page.locator>) {
  await row.hover();
  await row.getByRole('button', { name: 'Row actions' }).click();
}

// ── AC-AU-001 / AC-AU-003 / AC-AU-004 — full Admin management journey ──

test(
  'AC-AU-001 + AC-AU-003 + AC-AU-004: an Admin views the directory, changes a role (with confirm), and assigns a manager — goal oracle: the role pill and manager column reflect the changes',
  async ({ page }) => {
    const engineerEmail = 'engineer@acme.test'; // Tomas Beck
    const newManager = 'Mara Lindqvist'; // exec@acme.test, a valid manager candidate

    await login(page, 'admin@acme.test');
    await page.goto('/administration');
    await waitReady(page);

    // ── Step 1: AC-AU-001 — directory loads, invite CTA visible for Admin ──
    // "New user" was replaced with "Copy invite instructions" (AC-PJ-ADMIN-001).
    await expect(page.getByRole('button', { name: /copy invite instructions/i })).toBeVisible({ timeout: 10_000 });
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
    await expect(userRow(page, engineerEmail).getByText(newManager)).toBeVisible({ timeout: 15_000 });

    // ── Restore Dave's role to Engineer so the seed stays reusable ──
    await openRowMenu(page, userRow(page, engineerEmail));
    await page.getByRole('menuitem', { name: /edit role/i }).click();
    const restoreDialog = page.getByRole('dialog');
    await restoreDialog.getByLabel(/role/i).selectOption('Engineer');
    await restoreDialog.getByRole('button', { name: /save role/i }).click();
    await page.getByRole('dialog').getByRole('button', { name: /change role/i }).click();
    await expect(
      userRow(page, engineerEmail).getByRole('cell', { name: 'Engineer', exact: true }),
    ).toBeVisible({ timeout: 15_000 });
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
    // …but the management chrome is absent (not merely disabled).
    await expect(page.getByRole('button', { name: /copy invite instructions/i })).not.toBeVisible();
    await expect(page.getByRole('button', { name: /row actions/i })).not.toBeVisible();
    // and a read-only explanation is shown.
    await expect(page.getByText(/only an Admin can/i)).toBeVisible();
  },
);

// ── AC-AU-002b — non-admin/non-exec is gated out of the surface ──

test(
  'AC-AU-002b gating: an Engineer reaching /administration sees an Admin-only gate, not the directory',
  async ({ page }) => {
    await login(page, 'engineer@acme.test');
    await page.goto('/administration');

    // GOAL ORACLE: an Admin-only gate is shown and the directory rows are NOT rendered.
    await expect(page.getByText(/Admin-only area/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /copy invite instructions/i })).not.toBeVisible();
  },
);
