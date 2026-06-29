/**
 * AC-VB-E01 — Compose a view, save it, verify it renders in I3, check My Views list.
 * Curated cross-stack Playwright journey (ADR-0010, one e2e per genuine cross-stack AC).
 *
 * Prerequisites (CI seed): local Supabase running with at least one companies row.
 * Feature flag: VITE_FEATURES_USERVIEWS=true in .env.test.
 */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

test.describe('AC-VB-E01: View builder — compose, save, list, render', () => {
  test.beforeEach(async ({ page }) => {
    // Authenticate per-test — this repo has no global storageState; every e2e signs in.
    await signIn(page, 'admin@acme.test');
    await page.goto('/views/new');
    await expect(page).toHaveURL(/\/views\/new/);
  });

  test('AC-VB-E01: compose 1-panel view → save → renderer → My Views list', async ({ page }) => {
    // ── 1. Enter view name ──────────────────────────────────────────────────
    await page.getByRole('textbox', { name: /view name/i }).fill('Test View');

    // ── 2. Add a panel ──────────────────────────────────────────────────────
    await page.getByRole('button', { name: /add panel/i }).click();
    // Panel editor modal should open
    await expect(page.getByRole('dialog', { name: /add panel/i })).toBeVisible();

    // Select primitive DataTable
    await page.getByRole('combobox', { name: /primitive/i }).selectOption('DataTable');
    // Select entity companies
    await page.getByRole('combobox', { name: /entity/i }).selectOption('companies');
    // Select columns id and name
    await page.getByRole('checkbox', { name: 'id' }).check();
    await page.getByRole('checkbox', { name: 'name' }).check();
    // Confirm panel (last "Add panel" button is the modal submit)
    await page.getByRole('button', { name: /add panel/i }).last().click();
    await expect(page.getByRole('dialog')).not.toBeVisible();

    // ── 3. Save the view ────────────────────────────────────────────────────
    await page.getByRole('button', { name: /save view/i }).click();

    // ── 4. App navigates to /views/:newViewId — renderer shows the view ────
    await expect(page).toHaveURL(/\/views\/[^/]+$/);
    await expect(page.getByText('Test View')).toBeVisible();
    // The DataTable panel should render (companies data or empty state)
    await expect(
      page.getByRole('table').or(page.getByText(/no data/i)),
    ).toBeVisible({ timeout: 10_000 });

    // ── 5. Navigate to My Views list ────────────────────────────────────────
    await page.goto('/views');
    await expect(page).toHaveURL('/views');

    // ── 6. "Test View" appears in the list with an Edit affordance ──────────
    await expect(page.getByRole('link', { name: 'Test View' })).toBeVisible();
    // Row action menu should have an Edit entry
    await page.getByRole('button', { name: /row actions/i }).first().click();
    await expect(page.getByRole('menuitem', { name: /edit/i })).toBeVisible();
  });
});
