import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * AC-DOC-001  Project document register CRUD + status workflow — real user journey
 * (binding BDD authoring principle).
 *
 * The Documents tab on a project detail is the per-project document register (metadata only;
 * Storage is disabled so there is NO file upload — the "Attach file" affordance is a disabled
 * placeholder). Covered here in one sequential journey + two gate assertions:
 *
 *   AC-DOC-001  register loads for a write-role → "Add document" CTA visible
 *   AC-DOC-003  create a document → the new row appears in the register
 *   AC-DOC-004  edit the document → the change persists in the register
 *   AC-DOC-005  status workflow: Draft → Issued (author), then a DIFFERENT reviewer Approves
 *               (approver ≠ author SoD: the author may NOT approve their own document)
 *   AC-DOC-007  Engineer is read-only (no "Add document"); the "Attach file" control is disabled
 *
 * Isolation: a unique document title is generated inside the journey so all steps share the same
 * title and there is zero seed-coupling. Uses the seeded project P001.
 *
 * Roles: admin@acme.test (author of the doc), pm@acme.test (the independent reviewer who approves),
 *        engineer@acme.test (read-only gate).
 *
 * RBAC authority: docs/design/rbac-visibility.md §H — Add/Edit = Admin·Exec·PM·Finance;
 *                 Delete = Admin only; status approval = approver ≠ author; Engineer read-only.
 */

test.setTimeout(120_000);

const PROJECT = '40000000-0000-0000-0000-000000000001'; // seeded P001

/** Open the project's Documents tab and wait for the register to settle. */
async function openDocumentsTab(page: Page) {
  await page.goto(`/projects/${PROJECT}`);
  await page.getByRole('tab', { name: 'Documents' }).click();
  // The register's loading skeleton (ListState variant="loading") must clear.
  await expect(page.getByTestId('liststate-loading')).not.toBeVisible({ timeout: 20_000 });
}

/** Locate the register row whose Document cell contains `title`. */
function docRow(page: Page, title: string) {
  return page.locator('table tbody tr').filter({ hasText: title });
}

/** Hover a row and click its "Row actions" trigger (DataTable RowMenu). */
async function openRowMenu(page: Page, row: ReturnType<typeof page.locator>) {
  await row.hover();
  await row.getByRole('button', { name: 'Row actions' }).click();
}

// ── AC-DOC-001/003/004/005 — full register CRUD + SoD workflow journey ──

test(
  'AC-DOC-001 + AC-DOC-003 + AC-DOC-004 + AC-DOC-005: admin adds, edits, issues a document; a separate PM reviewer approves it — goal oracle: row present after create, updated after edit, status Issued then Approved, and the author cannot self-approve',
  async ({ page }) => {
    const runId = Date.now();
    const docTitle = `E2E-Doc-${runId}`;
    const docEdited = `${docTitle}-EDITED`;

    // ── Step 1: AC-DOC-001 — register loads, "Add document" CTA visible for Admin ──
    await login(page, 'admin@acme.test');
    await openDocumentsTab(page);
    const addBtn = page.getByRole('button', { name: /add document/i }).first();
    await expect(addBtn).toBeVisible({ timeout: 10_000 });

    // ── Step 2: AC-DOC-003 — create the document ──
    await addBtn.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8_000 });
    await dialog.getByLabel(/title/i).fill(docTitle);
    await dialog.getByLabel(/category/i).selectOption('Drawing');
    await dialog.getByRole('button', { name: /^add document$/i }).click();

    // GOAL ORACLE: modal closes; the new row IS in the register with a Draft status.
    await expect(dialog).not.toBeVisible({ timeout: 15_000 });
    const createdRow = docRow(page, docTitle);
    await expect(createdRow).toBeVisible({ timeout: 15_000 });
    await expect(createdRow.getByText('Draft')).toBeVisible();

    // ── Step 3: AC-DOC-004 — edit the document title ──
    await openRowMenu(page, createdRow);
    await page.getByRole('menuitem', { name: /^edit$/i }).click();
    const editDialog = page.getByRole('dialog');
    await expect(editDialog).toBeVisible({ timeout: 8_000 });
    const titleInput = editDialog.getByLabel(/title/i);
    await titleInput.clear();
    await titleInput.fill(docEdited);
    await editDialog.getByRole('button', { name: /save document/i }).click();

    // GOAL ORACLE: the edited title IS in the register.
    await expect(editDialog).not.toBeVisible({ timeout: 15_000 });
    const editedRow = docRow(page, docEdited);
    await expect(editedRow).toBeVisible({ timeout: 15_000 });

    // ── Step 4: AC-DOC-005 — issue the document (Draft → Issued) ──
    await openRowMenu(page, editedRow);
    await page.getByRole('menuitem', { name: /^issue$/i }).click();
    const issueDialog = page.getByRole('dialog');
    await expect(issueDialog).toBeVisible({ timeout: 8_000 });
    await issueDialog.getByRole('button', { name: /issue document/i }).click();

    // GOAL ORACLE: the row's status is now Issued.
    await expect(issueDialog).not.toBeVisible({ timeout: 15_000 });
    await expect(docRow(page, docEdited).getByText('Issued')).toBeVisible({ timeout: 15_000 });

    // ── Step 5: AC-DOC-005 SoD — the AUTHOR (admin) cannot approve their own document ──
    await openRowMenu(page, docRow(page, docEdited));
    // GOAL ORACLE: no Approve/Reject menu item for the author; the SoD reason is reachable.
    await expect(page.getByRole('menuitem', { name: /^approve$/i })).not.toBeVisible();
    await expect(page.getByRole('menuitem', { name: /why is review unavailable/i })).toBeVisible();
    // Close the menu before switching users.
    await page.keyboard.press('Escape');

    // ── Step 6: AC-DOC-005 — a DIFFERENT reviewer (PM) approves the Issued document ──
    await login(page, 'pm@acme.test');
    await openDocumentsTab(page);
    const pmRow = docRow(page, docEdited);
    await expect(pmRow).toBeVisible({ timeout: 15_000 });
    await openRowMenu(page, pmRow);
    await page.getByRole('menuitem', { name: /^approve$/i }).click();
    const approveDialog = page.getByRole('dialog');
    await expect(approveDialog).toBeVisible({ timeout: 8_000 });
    await approveDialog.getByRole('button', { name: /approve document/i }).click();

    // GOAL ORACLE: the document is now Approved (the SoD-respecting approval succeeded).
    await expect(approveDialog).not.toBeVisible({ timeout: 15_000 });
    await expect(docRow(page, docEdited).getByText('Approved')).toBeVisible({ timeout: 15_000 });
  },
);

// ── AC-DOC-007 — Engineer gating + the deferred file-upload affordance ──

test(
  'AC-DOC-007 gating: engineer sees a read-only register (no "Add document"); file-upload deferral is signposted by copy, not a dead button (D13)',
  async ({ page }) => {
    await login(page, 'engineer@acme.test');
    await openDocumentsTab(page);

    // GOAL ORACLE: no write affordance for the Engineer.
    await expect(page.getByRole('button', { name: /add document/i })).not.toBeVisible({ timeout: 10_000 });

    // D13 (honest-affordance): the dead disabled "Attach file" button is gone; the tab copy
    // now honestly teaches that files are uploaded on Draft rows, never via a fake disabled control.
    await expect(page.getByRole('button', { name: /attach file/i })).toHaveCount(0);
    await expect(
      page.getByText(/Drawings, specifications, and transmittals for this project\. Upload files on Draft rows\./i),
    ).toBeVisible();
  },
);
