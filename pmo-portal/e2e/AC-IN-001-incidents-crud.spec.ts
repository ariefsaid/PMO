import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * AC-IN-001  Incident register CRUD — real user journey (binding BDD authoring principle).
 *
 * Covers in one sequential journey:
 *   AC-IN-001  list loads → "File incident" CTA is visible (to ANY member, incl. Engineer)
 *   AC-IN-003  Engineer files an incident → the new row appears in the list with its badges
 *   AC-IN-004  a manager (PM) advances it Open→Investigating, then Investigating→Closed
 *              → the workflow status updates in the list
 *
 * Plus gate assertions:
 *   AC-IN-006  every role sees the Incidents nav (here: Engineer)
 *   AC-IN-007  an Engineer sees NO investigate/close row actions (managers only)
 *
 * Isolation: the unique incident type is generated inside the journey test so all
 * steps share the same sentinel and there is zero seed-coupling.
 *
 * Roles: engineer@acme.test (files; cannot close), pm@acme.test (manager: investigate/close).
 *
 * RBAC authority: docs/design/rbac-visibility.md §G — ANY member files; only managers
 *                 (Admin·Exec·PM) investigate/close; Incidents nav visible to all roles.
 */

// ⚑ QUARANTINED (2026-06-15): the Incidents module is hidden behind the interim UI feature flag
// (src/lib/features.ts `incidents: false`, "UI-hide-first" — docs/backlog.md §OPEN feature tracks).
// The /incidents routes now redirect home, so this journey is intentionally unreachable. Behaviour
// is preserved in code/DAL/RLS; un-skip these tests when the module is re-enabled (flip the flag).
// QUARANTINE: feature flag incidents=false — un-skip when src/lib/features.ts incidents is true
test.setTimeout(120_000);

/** Wait for the Incidents page to finish its initial data fetch. */
async function waitReady(page: Page) {
  await expect(page.getByTestId('liststate-loading')).not.toBeVisible({ timeout: 20_000 });
}

/**
 * Locate the DataTable row for incident `type`. CW-4a made rows activatable (they open the
 * routable `/incidents/:id` detail page), so the first cell now carries an "Open <type>"
 * activation button — match on that control rather than a bare exact-text cell.
 */
function incidentRow(page: Page, type: string) {
  return page.locator('table tbody tr').filter({
    has: page.getByRole('button', { name: new RegExp(`open ${type}`, 'i') }),
  });
}

/** Hover a row and click its "Row actions" trigger (DataTable RowMenu). */
async function openRowMenu(page: Page, row: ReturnType<typeof page.locator>) {
  await row.hover();
  await row.getByRole('button', { name: 'Row actions' }).click();
}

// ── AC-IN-006 / AC-IN-007 — Engineer files; cannot investigate/close ─────────

test.skip(
  'QUARANTINE: feature flag incidents=false — un-skip when src/lib/features.ts incidents is true (AC-IN-001 + AC-IN-003 + AC-IN-006 + AC-IN-007)',
  async ({ page }) => {
    const runId = Date.now();
    const inType = `E2E-Incident-${runId}`;

    await login(page, 'engineer@acme.test');

    // AC-IN-006: every role (incl. Engineer) has the Incidents nav item.
    await expect(page.getByRole('link', { name: /Incidents/i })).toBeVisible({ timeout: 10_000 });
    await page.goto('/incidents');
    await waitReady(page);

    // AC-IN-001: "File incident" CTA is visible to any member.
    const fileBtn = page.getByRole('button', { name: /file incident/i });
    await expect(fileBtn).toBeVisible({ timeout: 10_000 });

    // AC-IN-003: file the incident.
    await fileBtn.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8_000 });

    await dialog.getByLabel(/date/i).fill('2026-06-08');
    await dialog.getByLabel(/^type/i).fill(inType);
    // Severity SelectField renders a native <select>
    await dialog.locator('select').first().selectOption('High');
    await dialog.getByLabel(/location/i).fill('Regional Site B');
    await dialog.getByLabel(/description/i).fill('E2E filed incident');
    await dialog.getByRole('button', { name: /^file incident$/i }).click();

    // GOAL ORACLE: modal closes; new row IS in the list with severity + Open status.
    await expect(dialog).not.toBeVisible({ timeout: 15_000 });
    const row = incidentRow(page, inType);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByText('High')).toBeVisible();
    await expect(row.getByText('Open')).toBeVisible();

    // AC-IN-007: an Engineer is not a manager → no investigate/close row menu on the row.
    await row.hover();
    await expect(row.getByRole('button', { name: 'Row actions' })).toHaveCount(0);
  },
);

// ── AC-IN-004 — a manager (PM) drives the Open→Investigating→Closed workflow ──

test.skip(
  'QUARANTINE: feature flag incidents=false — un-skip when src/lib/features.ts incidents is true (AC-IN-004)',
  async ({ page }) => {
    const runId = Date.now();
    const inType = `E2E-Workflow-${runId}`;

    // The PM both files and then advances the incident, so the journey is self-seeding.
    await login(page, 'pm@acme.test');
    await page.goto('/incidents');
    await waitReady(page);

    await page.getByRole('button', { name: /file incident/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8_000 });
    await dialog.getByLabel(/date/i).fill('2026-06-08');
    await dialog.getByLabel(/^type/i).fill(inType);
    await dialog.locator('select').first().selectOption('Medium');
    await dialog.getByRole('button', { name: /^file incident$/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 15_000 });

    const row = incidentRow(page, inType);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByText('Open')).toBeVisible();

    // AC-IN-004: Open → Investigating (via row menu + default-tone confirm).
    await openRowMenu(page, row);
    await page.getByRole('menuitem', { name: /start investigating/i }).click();
    const investigateDialog = page.getByRole('dialog');
    await expect(investigateDialog).toBeVisible({ timeout: 8_000 });
    await investigateDialog.getByRole('button', { name: /start investigating/i }).click();

    // GOAL ORACLE: the row's status badge becomes Investigating.
    await expect(row.getByText('Investigating')).toBeVisible({ timeout: 15_000 });

    // AC-IN-004: Investigating → Closed.
    await openRowMenu(page, row);
    await page.getByRole('menuitem', { name: /close incident/i }).click();
    const closeDialog = page.getByRole('dialog');
    await expect(closeDialog).toBeVisible({ timeout: 8_000 });
    await closeDialog.getByRole('button', { name: /close incident/i }).click();

    // GOAL ORACLE: the row's status badge becomes Closed (terminal).
    await expect(row.getByText('Closed')).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/incidents/);
  },
);
