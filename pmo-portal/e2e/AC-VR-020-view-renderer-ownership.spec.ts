/**
 * AC-VR-020 — View-renderer ownership: a private view is accessible only to its owner.
 *
 * Proves the deputy model (NFR-VR-SEC-001, ADR-0036 §2): a viewer's JWT scopes
 * what rows executeCompiledQuery returns — sharing never leaks another user's data.
 *
 * Two-user journey:
 *   Alice (admin@acme.test)  — creates a private view and sees it rendered.
 *   Bob   (engineer@acme.test) — opens the same viewId and sees the not-found guard.
 *
 * Precondition: the test inserts a user_views row directly via the Supabase service-role
 * client (test-only) so it does not depend on the I4 builder UI. The row is cleaned up
 * in the afterAll hook.
 *
 * Runs in: CI `integration` job (PR→main). NOT run locally.
 * pgTAP already proves the RLS isolation (I1); this e2e proves the renderer surfaces it.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { signIn } from './helpers';

test.setTimeout(120_000);

const SERVICE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ALICE_EMAIL = 'admin@acme.test';
const BOB_EMAIL = 'engineer@acme.test';

const SEED_SPEC = {
  version: 1,
  panels: [{
    id: 'kpi-1',
    primitive: 'KPITile',
    querySpec: {
      entity: 'projects',
      select: ['id'],
      aggregate: { fn: 'count', column: 'id', alias: 'total' },
    },
    props: { icon: 'doc', tone: 'blue', label: 'Project Count' },
  }],
};

let viewId: string | null = null;

test.beforeAll(async () => {
  // Insert a private user_views row owned by Alice via the service-role client
  // (test-only; never used in the app). We look up Alice's profile id first.
  if (!SERVICE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for AC-VR-020 e2e test');
  }
  const admin = createClient(SERVICE_URL, SERVICE_KEY);
  const { data: aliceProfile } = await admin
    .from('profiles')
    .select('id, org_id')
    .eq('email', ALICE_EMAIL)
    .single();
  if (!aliceProfile) throw new Error(`Alice profile not found for ${ALICE_EMAIL}`);

  const { data: inserted, error } = await admin
    .from('user_views')
    .insert({
      name: "Alice's Dashboard",
      spec: SEED_SPEC,
      scope: 'private',
      org_id: aliceProfile.org_id,
      user_id: aliceProfile.id,
    })
    .select('id')
    .single();
  if (error || !inserted) throw new Error(`Failed to seed view: ${error?.message}`);
  viewId = inserted.id;
});

test.afterAll(async () => {
  if (viewId) {
    const admin = createClient(SERVICE_URL, SERVICE_KEY);
    await admin.from('user_views').delete().eq('id', viewId);
  }
});

test('AC-VR-020: Alice sees her private view rendered with the KPITile panel', async ({ page }) => {
  // Feature must be on for this test; the CI env sets FEATURES.userViews = true via
  // VITE_FEATURES_USERVIEWS=true in the integration job environment.
  await signIn(page, ALICE_EMAIL);
  await page.goto(`/views/${viewId}`);
  // The renderer shows the view heading (not the not-found state)
  await expect(page.getByRole('heading', { name: "Alice's Dashboard" })).toBeVisible({ timeout: 20_000 });
  // The KPITile panel label is visible
  await expect(page.getByText('Project Count')).toBeVisible({ timeout: 15_000 });
  // No error state
  await expect(page.getByText(/this view was not found/i)).not.toBeVisible();
});

test("AC-VR-020: Bob opens the same viewId and sees the not-found guard (not Alice's data)", async ({ page }) => {
  await signIn(page, BOB_EMAIL);
  await page.goto(`/views/${viewId}`);
  // Bob should see the not-found guard — RLS returns null for a private view he doesn't own
  await expect(page.getByText(/this view was not found/i)).toBeVisible({ timeout: 20_000 });
  // Bob must NOT see Alice's data or heading
  await expect(page.getByRole('heading', { name: "Alice's Dashboard" })).not.toBeVisible();
  await expect(page.getByText('Project Count')).not.toBeVisible();
});
