// @e2e-isolation: self-isolated — the Admin creates one project named with the exclusive prefix "E2E RAM-001 " plus a run id; beforeEach and afterEach service-role-delete that prefix in the seed org (the AC-PRJ-006 cleanup pattern). No shared seed row is written.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { signIn, pickComboboxOption, requireServiceRoleKey, visibleToast } from './helpers';

/**
 * AC-RAM-001 (#688) — the ONE curated cross-stack journey for the RIS Admin route (ADR-0010):
 * organization setup → first project → its canonical record → back to the list that holds it.
 *
 * The journey is the natural one for a new organization: Projects' "New project" is the first action
 * a new org is offered, and the Projects page itself says "Pre-win projects live in the Pipeline." — so
 * that is where the user goes to find what they created. GOAL ORACLES: the success message names the
 * project; the record opens at the canonical /projects/:id in its pipeline lens; the return link lands on
 * a list that contains the project.
 *
 * Code proof with the seed-org sample Admin. It does NOT prove live RIS Microsoft 365 / ERPNext data
 * transfer (LIVE-1..4 in docs/specs/ris-admin-route-matrix.spec.md stay manual).
 */

const ADMIN = 'admin@acme.test';
const SEED_ORG = '00000000-0000-0000-0000-000000000001';
const NAME_PREFIX = 'E2E RAM-001 ';
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';

function adminClient() {
  const host = new URL(SUPABASE_URL).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error('AC-RAM-001 cleanup requires the local Supabase stack');
  }
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-RAM-001 requires the local Supabase service role key; run through scripts/e2e-local.sh');
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
}

async function deleteOwnedProjects() {
  const { error } = await adminClient()
    .from('projects')
    .delete()
    .eq('org_id', SEED_ORG)
    .like('name', `${NAME_PREFIX}%`);
  if (error) throw new Error(`AC-RAM-001 cleanup failed: ${error.message}`);
}

test.setTimeout(120_000);
test.beforeEach(deleteOwnedProjects);
test.afterEach(deleteOwnedProjects);

test('AC-RAM-001: a RIS Admin goes from organization setup to a first project, opens its record, and returns to the list that holds it', async ({
  page,
}) => {
  const name = `${NAME_PREFIX}${Date.now()}`;
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, ADMIN);

  // 1 — Setup: Administration opens on Users; the Admin checks Organization integrations.
  await page.getByRole('link', { name: 'Administration', exact: true }).click();
  await expect(page).toHaveURL(/\/administration\/users$/);
  await page
    .getByRole('navigation', { name: 'Administration sections' })
    .getByRole('link', { name: 'Organization integrations' })
    .click();
  await expect(page).toHaveURL(/\/administration\/integrations$/);
  await expect(page.getByRole('heading', { level: 2, name: 'Organization integrations' })).toBeVisible();

  // 2 — Work: Projects from the primary rail.
  const rail = page.getByRole('navigation', { name: 'Primary navigation' });
  await rail.getByRole('link', { name: 'Projects', exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByTestId('projects-loading')).not.toBeVisible({ timeout: 20_000 });

  // 3 — Create the first project.
  await page.getByRole('button', { name: /new project/i }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 8_000 });
  await dialog.getByLabel(/project name/i).fill(name);
  await pickComboboxOption(dialog, page, /client company/i, 'first');
  await dialog.getByRole('button', { name: /^Create project$/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 15_000 });
  // GOAL: success names the created record, and the app opens the new record directly (FR-RAM-009 / AC-RAM-006).
  await expect(visibleToast(page, 'Project created')).toContainText(name);

  // 4 — GOAL: the canonical record, in its pipeline lens, opened directly (no detour through Sales).
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+/);
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByLabel('Project stage journey')).toBeVisible();

  // 5 — GOAL: the return link lands on the list that holds the project.
  await page.getByRole('link', { name: /Back to Sales Pipeline/ }).click();
  await expect(page).toHaveURL(/\/sales$/);
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 15_000 });
});
