import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * AC-CO-001  Companies CRUD — real user journey (binding BDD authoring principle).
 *
 * Covers in one sequential journey:
 *   AC-CO-001  list loads for write-role → "New company" CTA is visible
 *   AC-CO-003  create company → new row appears in the list
 *   AC-CO-004  edit company   → the change persists in the list
 *   AC-CO-005  archive company → it leaves the default list
 *
 * Plus a separate gate assertion:
 *   AC-CO-001b Engineer does NOT see "New company" (RBAC gating)
 *
 * Isolation: the unique company name is generated inside the journey test so all
 * steps share the same name and there is zero seed-coupling.
 *
 * Roles: admin@acme.test (full write), engineer@acme.test (read-only gate).
 *
 * RBAC authority: docs/design/rbac-visibility.md §D — Admin ● create/edit/archive;
 *                 Engineer ○ (no Companies nav, no New company button).
 */

test.setTimeout(120_000);

/** Wait for the Companies page to finish its initial data fetch. */
async function waitReady(page: Page) {
  // The loading variant renders <ListState variant="loading"> → data-testid="liststate-loading"
  // (aria-busy). Wait until that marker is gone, mirroring AC-1011/AC-401's projects-loading wait.
  // The previous `[data-slot="skeleton"]` selector matched nothing → the wait was a silent no-op.
  await expect(page.getByTestId('liststate-loading')).not.toBeVisible({ timeout: 20_000 });
}

/**
 * Locate the DataTable row whose first cell exactly matches `name`.
 * Uses a RegExp anchored to full-word boundaries to prevent a substring of a
 * longer name from matching (e.g. "E2E-Co-123" must not match "E2E-Co-123-EDITED").
 */
function companyRow(page: Page, name: string) {
  // The first <td> cell renders the name in a <span>; getByRole('cell') scoped to
  // exact text is the most robust anchor without coupling to DOM nesting.
  return page.locator('table tbody tr').filter({
    has: page.getByRole('cell', { name, exact: true }),
  });
}

/** Hover a row and click its "Row actions" trigger (DataTable RowMenu). */
async function openRowMenu(page: Page, row: ReturnType<typeof page.locator>) {
  await row.hover();
  // DataTable's RowMenu trigger carries aria-label="Row actions"
  await row.getByRole('button', { name: 'Row actions' }).click();
}

// ── AC-CO-001 / AC-CO-003 / AC-CO-004 / AC-CO-005 — full admin CRUD journey ──

test(
  'AC-CO-001 + AC-CO-003 + AC-CO-004 + AC-CO-005: admin creates, edits, then archives a company — goal oracle: row present after create, updated after edit, gone after archive',
  async ({ page }) => {
    // Unique sentinel: generated inside the test so all steps share the same name.
    const runId    = Date.now();
    const coName   = `E2E-Co-${runId}`;
    const coEdited = `${coName}-EDITED`;
    const coType   = 'Vendor';

    await login(page, 'admin@acme.test');
    await page.goto('/companies');
    await waitReady(page);

    // ── Step 1: AC-CO-001 — "New company" CTA is visible for Admin ────────────
    const newBtn = page.getByRole('button', { name: /new company/i });
    await expect(newBtn).toBeVisible({ timeout: 10_000 });

    // ── Step 2: AC-CO-003 — create the company ────────────────────────────────
    await newBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8_000 });

    await dialog.getByLabel(/company name/i).fill(coName);
    // SelectField for Type renders as a native <select>
    await dialog.locator('select').first().selectOption(coType);
    await dialog.getByRole('button', { name: /create company/i }).click();

    // GOAL ORACLE: modal closes; new row IS in the list with correct type
    await expect(dialog).not.toBeVisible({ timeout: 15_000 });
    const createRow = companyRow(page, coName);
    await expect(createRow).toBeVisible({ timeout: 15_000 });
    await expect(createRow.getByText('Vendor')).toBeVisible();

    // ── Step 3: AC-CO-004 — edit the company ──────────────────────────────────
    await openRowMenu(page, createRow);
    await page.getByRole('menuitem', { name: /^edit$/i }).click();

    const editDialog = page.getByRole('dialog');
    await expect(editDialog).toBeVisible({ timeout: 8_000 });

    const nameInput = editDialog.getByLabel(/company name/i);
    await nameInput.clear();
    await nameInput.fill(coEdited);
    await editDialog.getByRole('button', { name: /save company/i }).click();

    // GOAL ORACLE: modal closes; edited name IS in the list; original exact name IS gone
    await expect(editDialog).not.toBeVisible({ timeout: 15_000 });
    const editedRow = companyRow(page, coEdited);
    await expect(editedRow).toBeVisible({ timeout: 15_000 });
    // The UN-edited name cell must not appear (exact match so "-EDITED" row won't confuse)
    await expect(companyRow(page, coName)).not.toBeVisible({ timeout: 5_000 });

    // ── Step 4: AC-CO-005 — archive the company ───────────────────────────────
    await openRowMenu(page, editedRow);
    await page.getByRole('menuitem', { name: /^archive$/i }).click();

    // ConfirmDialog (default tone) — confirm the archive action
    const archiveDialog = page.getByRole('dialog');
    await expect(archiveDialog).toBeVisible({ timeout: 8_000 });
    await archiveDialog.getByRole('button', { name: /archive company/i }).click();

    // GOAL ORACLE: the row IS gone from the default (non-archived) list
    await expect(editedRow).not.toBeVisible({ timeout: 15_000 });
    // The page is still the companies index (no error / redirect)
    await expect(page).toHaveURL(/\/companies/);
  },
);

// ── AC-CO-001c — the toolbar search is reachable at 375px (no off-screen clip) ──

test(
  'AC-CO-001c responsive: at 375px the Companies content fits the viewport and the toolbar search is fully reachable (not clipped)',
  async ({ page }) => {
    // Regression guard for the CSS-grid blowout: a bare `1fr` main track took a
    // min-content minimum, so a wide data table/toolbar pushed `main` past the
    // viewport and clipped the right-aligned search. The fix (minmax(0,1fr) +
    // min-w-0 on <main>) lets the track shrink. jsdom can't see layout, so this
    // is proven in a real browser.
    await page.setViewportSize({ width: 375, height: 812 });
    await login(page, 'admin@acme.test');
    await page.goto('/companies');
    await waitReady(page);

    // The toolbar (and its search) only render after the loading state clears.
    const search = page.getByRole('searchbox', { name: /Search companies/i });
    await expect(search).toBeVisible({ timeout: 10_000 });

    const overflow = await page.evaluate(() => {
      const main = document.querySelector('main')!;
      const input = document.querySelector('input[aria-label="Search companies"]')!;
      const box = input.getBoundingClientRect();
      return {
        mainWidth: Math.round(main.getBoundingClientRect().width),
        vw: window.innerWidth,
        searchRight: Math.round(box.right),
        searchLeft: Math.round(box.left),
      };
    });
    // GOAL ORACLE: main does not exceed the viewport, and the search sits fully
    // inside it (no horizontal clipping of the right-edge control).
    expect(overflow.mainWidth).toBeLessThanOrEqual(overflow.vw + 1);
    expect(overflow.searchRight).toBeLessThanOrEqual(overflow.vw);
    expect(overflow.searchLeft).toBeGreaterThanOrEqual(0);
  },
);

// ── AC-CO-001b — Engineer gating ─────────────────────────────────────────────

test(
  'AC-CO-001b gating: engineer does not see the New company button on /companies',
  async ({ page }) => {
    // Engineer has no Companies nav item but can navigate to the URL directly.
    // The write affordance must be HIDDEN (not merely disabled).
    await login(page, 'engineer@acme.test');
    await page.goto('/companies');
    await waitReady(page);

    // GOAL ORACLE: "New company" button is NOT visible for Engineer
    await expect(
      page.getByRole('button', { name: /new company/i }),
    ).not.toBeVisible({ timeout: 10_000 });
  },
);
