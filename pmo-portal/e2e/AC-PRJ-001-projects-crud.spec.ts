import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * AC-PRJ-001  Projects / Opportunities CRUD — real user journeys (binding BDD authoring principle).
 *
 * Covers:
 *   AC-PRJ-003  PM creates a new deal (Leads opportunity) → the new row appears in the index
 *   AC-PRJ-004  PM edits the project header (name) on the detail page → the change persists
 *   AC-PRJ-005  Executive archives a project → it leaves the default index
 *   AC-PRJ-006  contract_value SoD: on a WON/on-hand project, Finance CAN edit the value (money
 *               authority) and PM sees it READ-ONLY (the segregation of duties)
 *   AC-PRJ-007  gating: Finance does NOT see "New deal" (FE stricter than RLS)
 *
 * Roles (seed.sql): pm@acme.test, exec@acme.test, finance@acme.test.
 * On-hand seed project: P001 "Innovate Corp HQ Fit-Out" (status Ongoing Project), PM = pm@acme.test.
 *
 * RBAC authority: docs/design/rbac-visibility.md §B/§B2 + docs/adr/0019.
 * The contract_value RPC (set_project_contract_value, 0014) is the sole writer; pgTAP
 * 0052_project_value_sod.test.sql owns the RLS/SoD contract — this e2e proves the user journey.
 */

test.setTimeout(120_000);

async function waitProjectsReady(page: Page) {
  await expect(page.getByTestId('projects-loading')).not.toBeVisible({ timeout: 20_000 });
}

/** A project index DataTable row whose Project cell exactly matches `name`. */
function projectRow(page: Page, name: string) {
  return page.locator('table tbody tr').filter({ has: page.getByRole('button', { name, exact: true }) });
}

// ── AC-PRJ-003 / AC-PRJ-004 / AC-PRJ-005 — full delivery CRUD journey ──────────

test(
  'AC-PRJ-003 + AC-PRJ-004 + AC-PRJ-005: PM creates a deal, edits its header, then Exec archives it — goal oracle: row present after create, updated after edit, gone after archive',
  async ({ page }) => {
    const runId = Date.now();
    const dealName = `E2E-Deal-${runId}`;
    const editedName = `${dealName}-EDITED`;

    // ── Step 1: AC-PRJ-003 — PM creates a new deal ─────────────────────────────
    await login(page, 'pm@acme.test');
    await page.goto('/projects');
    await waitProjectsReady(page);

    const newBtn = page.getByRole('button', { name: /new deal/i });
    await expect(newBtn).toBeVisible({ timeout: 10_000 });
    await newBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8_000 });
    await dialog.getByLabel(/opportunity name/i).fill(dealName);
    // Client company FK picker (Combobox): open, then pick the first option.
    await dialog.getByRole('combobox', { name: /client company/i }).click();
    const clientList = page.getByRole('listbox');
    await clientList.getByRole('option').first().click();
    await dialog.getByRole('button', { name: /^Create deal$/i }).click();

    // GOAL ORACLE: modal closes; the new deal IS in the index.
    await expect(dialog).not.toBeVisible({ timeout: 15_000 });
    const createdRow = projectRow(page, dealName);
    await expect(createdRow).toBeVisible({ timeout: 15_000 });

    // ── Step 2: AC-PRJ-004 — PM edits the header on the detail page ────────────
    await createdRow.getByRole('button', { name: dealName, exact: true }).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+/);
    await page.getByRole('button', { name: /^Edit$/i }).click();

    const editDialog = page.getByRole('dialog');
    await expect(editDialog).toBeVisible({ timeout: 8_000 });
    const nameInput = editDialog.getByLabel(/opportunity name/i);
    await nameInput.clear();
    await nameInput.fill(editedName);
    await editDialog.getByRole('button', { name: /save project/i }).click();

    // GOAL ORACLE: the edited name shows in the detail header.
    await expect(editDialog).not.toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: editedName })).toBeVisible({ timeout: 15_000 });

    // ── Step 3: AC-PRJ-005 — Executive archives the project ────────────────────
    await page.getByRole('link', { name: /sign out/i }).click().catch(() => {});
    await login(page, 'exec@acme.test');
    await page.goto('/projects');
    await waitProjectsReady(page);

    const exRow = projectRow(page, editedName);
    await expect(exRow).toBeVisible({ timeout: 15_000 });
    await exRow.getByRole('button', { name: editedName, exact: true }).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+/);

    await page.getByRole('button', { name: /Archive/i }).click();
    const archiveDialog = page.getByRole('alertdialog');
    await expect(archiveDialog).toBeVisible({ timeout: 8_000 });
    await archiveDialog.getByRole('button', { name: /archive project/i }).click();

    // GOAL ORACLE: back on the index, the archived project is gone from the default list.
    await page.goto('/projects');
    await waitProjectsReady(page);
    await expect(projectRow(page, editedName)).not.toBeVisible({ timeout: 15_000 });
  },
);

// ── AC-PRJ-006 — contract_value SoD on a WON/on-hand project ──────────────────

test(
  'AC-PRJ-006 SoD: on a won project, Finance can edit the contract value and a new figure is recorded; the PM sees it read-only',
  async ({ page }) => {
    // P001 "Innovate Corp HQ Fit-Out" is status Ongoing Project (on-hand) in the seed.
    const projectName = 'Innovate Corp HQ Fit-Out';

    // PM view: the value is locked (read-only) on a won project.
    await login(page, 'pm@acme.test');
    await page.goto('/projects');
    await waitProjectsReady(page);
    await projectRow(page, projectName).getByRole('button', { name: projectName, exact: true }).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+/);
    const sod = page.getByTestId('contract-value-sod');
    // GOAL ORACLE: PM sees the "Read-only" lock, NOT an edit control.
    await expect(sod.getByText(/Read-only/i)).toBeVisible({ timeout: 10_000 });
    await expect(sod.getByRole('button', { name: /Edit contract value/i })).toHaveCount(0);

    // Finance view: money authority can edit the value behind the audit confirm.
    await login(page, 'finance@acme.test');
    await page.goto('/projects');
    await waitProjectsReady(page);
    await projectRow(page, projectName).getByRole('button', { name: projectName, exact: true }).click();
    const sodFin = page.getByTestId('contract-value-sod');
    await sodFin.getByRole('button', { name: /Edit contract value/i }).click();
    const valueInput = page.getByRole('textbox', { name: /Contract value/i });
    await valueInput.fill('5250000');
    await page.getByRole('button', { name: /^Save$/i }).click();

    // The audit confirm names the SoD; confirm commits via the RPC.
    const confirm = page.getByRole('dialog');
    await expect(confirm).toContainText(/segregation of duties/i);
    await confirm.getByRole('button', { name: /record/i }).click();

    // GOAL ORACLE: the new value is reflected in the detail header.
    await expect(page.getByText(/\$5,250,000/)).toBeVisible({ timeout: 15_000 });
  },
);

// ── AC-PRJ-007 — gating: Finance does not see "New deal" ──────────────────────

test(
  'AC-PRJ-007 gating: Finance does not see the New deal button on /projects (FE stricter than RLS)',
  async ({ page }) => {
    await login(page, 'finance@acme.test');
    await page.goto('/projects');
    await waitProjectsReady(page);
    // GOAL ORACLE: "New deal" is HIDDEN for Finance (FE excludes Finance from project create).
    await expect(page.getByRole('button', { name: /new deal/i })).not.toBeVisible({ timeout: 10_000 });
  },
);
