// @e2e-isolation: self-isolated — unique view name (Date.now()) + afterEach service-role cleanup of user_views row.
/**
 * AC-VB-E01 — Compose a view, save it, verify it renders in I3, check My Views list.
 * Curated cross-stack Playwright journey (ADR-0010, one e2e per genuine cross-stack AC).
 *
 * Prerequisites (CI seed): local Supabase running with at least one companies row.
 * Feature flag: VITE_FEATURES_USERVIEWS=true in .env.test.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { signIn } from './helpers';
import { execSync } from 'node:child_process';

function readSupabaseEnv(name: string): string {
  const output = execSync('supabase status -o env', { encoding: 'utf8' });
  const match = output.match(new RegExp(`^${name}="([^"]+)"$`, 'm'));
  if (!match) throw new Error(`Missing ${name} from supabase status -o env`);
  return match[1];
}

test.describe('AC-VB-E01: View builder — compose, save, list, render', () => {
  let viewId: string | undefined;

  test.beforeEach(async ({ page }) => {
    // Authenticate per-test — this repo has no global storageState; every e2e signs in.
    await signIn(page, 'admin@acme.test');
    await page.goto('/views/new');
    await expect(page).toHaveURL(/\/views\/new/);
  });

  test.afterEach(async () => {
    if (!viewId) return;
    const admin = createClient(readSupabaseEnv('API_URL'), readSupabaseEnv('SERVICE_ROLE_KEY'));
    await admin.from('user_views').delete().eq('id', viewId);
    viewId = undefined;
  });

  test('AC-VB-E01: compose 1-panel view → save → renderer → My Views list', async ({ page }) => {
    const uniqueName = `Test View ${Date.now()}`;

    // ── 1. Enter view name ──────────────────────────────────────────────────
    await page.getByRole('textbox', { name: /view name/i }).fill(uniqueName);

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
    // Capture the new view ID from the URL for cleanup
    const urlMatch = page.url().match(/\/views\/([^/]+)$/);
    if (urlMatch) viewId = urlMatch[1];
    // Scope to <main>: the view name also appears in the rail's "My Views" nav
    // group (links) and a save toast (status), so an unscoped getByText is ambiguous.
    await expect(
      page.getByRole('main').getByRole('heading', { name: uniqueName }),
    ).toBeVisible({ timeout: 10_000 });
    // The DataTable panel should render (companies data or empty state)
    await expect(
      page.getByRole('table').or(page.getByText(/no data/i)),
    ).toBeVisible({ timeout: 10_000 });

    // ── 5. Navigate to My Views list ────────────────────────────────────────
    await page.goto('/views');
    await expect(page).toHaveURL('/views');

    // ── 6. Unique view name appears in the list with an Edit affordance ──────────
    // Scope to <main> so the list link is matched, not the rail's "My Views" nav links.
    await expect(page.getByRole('main').getByRole('link', { name: uniqueName })).toBeVisible();
    // Row action menu should have an Edit entry
    await page.getByRole('button', { name: /row actions/i }).first().click();
    await expect(page.getByRole('menuitem', { name: /edit/i })).toBeVisible();
  });
});