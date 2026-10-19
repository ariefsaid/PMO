// @e2e-isolation: serial — confirms a link into the org's shared ERP project map (org-global binding config) against the shared ERP bench; uses the prepared disposable ERP binding.
/**
 * AC-S09-005 — S-09 (#1135) "Review ERP project matches, never manufacture them from the queue".
 *
 * Given an Admin, a dedicated synthetic delivery project (unique name) and an EXISTING ERP Project
 * of the same name on the prepared test bench,
 * When the Admin opens Administration > Organization integrations, sees the exact-name match
 * proposed for that project, chooses it, reviews the named current -> proposed identity and
 * confirms,
 * Then after a hard reload the confirmed ERP target is still the project's link (shown on the
 * project page and stored in the ERP project map), the queue no longer proposes the project, and
 * the ERP Project count on the bench is unchanged — the review never created an ERP Project.
 *
 * Real boundaries only (no `page.route`): the real served `external-set-company` function, the real
 * Postgres RPC and the real ERP bench. A mocked write is not persistence proof (S09.spec AC-S09-005).
 *
 * Pattern: `serial/AC-SETUP-001-project-erp-link.spec.ts` (prepared, already-activated disposable ERP
 * binding; bench readback via REST; binding config restored in `finally`) + `serial/_budHelpers.ts` /
 * `AC-BUD-030` (a real browser journey over the served lane). Gated on the DEPENDENCY
 * (SUPABASE_FUNCTIONS_URL + bench env), never on `process.env.CI`: skip when the lane is absent,
 * throw when it is up but misconfigured.
 *
 * Fixtures: nothing new in seed. The spec creates (and removes) one PMO project and one ERP Project.
 * It needs the same prepared binding AC-SETUP-001 needs (active, HTTPS `site_url`, `config.company`)
 * and <100 active ERP Projects for that Company (the unfiltered candidate list is capped at 100;
 * beyond it no unique proposal is made by design, FR-003).
 *
 * Run: scripts/with-db-lock.sh scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- \
 *        npx playwright test e2e/serial/AC-S09-005
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { login } from '../helpers';
import { signInAdmin } from './_sarHelpers';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const BENCH_URL = process.env.ERPNEXT_BENCH_URL ?? '';
const BENCH_KEY = process.env.ERPNEXT_BENCH_API_KEY ?? '';
const BENCH_SECRET = process.env.ERPNEXT_BENCH_API_SECRET ?? '';
const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const ADMIN_EMAIL = 'admin@acme.test';

const READY = Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY && SERVICE_KEY && BENCH_URL && BENCH_KEY && BENCH_SECRET);
if (FUNCTIONS_URL && !READY) {
  throw new Error('AC-S09-005: the served setup lane is up but its disposable ERP fixture env is incomplete — never a silent skip.');
}
test.skip(!READY, 'AC-S09-005 requires the prepared local served setup lane and disposable ERP binding.');
test.setTimeout(180_000);

const benchHeaders = { Authorization: `token ${BENCH_KEY}:${BENCH_SECRET}`, 'Content-Type': 'application/json' };

/** Every ERP Project on the bench (any company, any state) — "no ERP project was created" is global. */
async function erpProjectCount(): Promise<number> {
  const res = await fetch(`${BENCH_URL}/api/method/frappe.client.get_count?doctype=Project`, { headers: benchHeaders });
  expect(res.status, 'bench Project count must be readable').toBe(200);
  return Number((await res.json()).message);
}

test('AC-S09-005 an Admin confirms a proposed match to an existing ERP project; it persists across reload and no ERP project is created', async ({ page }) => {
  const admin = createClient(AUTH_URL, SERVICE_KEY);
  const token = await signInAdmin(AUTH_URL, ANON_KEY);

  const { data: binding, error: bindingError } = await admin
    .from('external_org_bindings')
    .select('config,site_url,activated_at')
    .eq('org_id', ORG_ID)
    .eq('external_tier', 'erpnext')
    .single();
  expect(bindingError).toBeNull();
  expect(binding?.activated_at).toBeTruthy();
  expect(binding?.config?.company).toEqual(expect.any(String));
  const company = binding!.config.company as string;

  const projectId = crypto.randomUUID();
  const projectName = `AC-S09-005 Match ${crypto.randomUUID()}`;
  let erpProject: string | undefined;

  try {
    // -- Given: an EXISTING ERP Project (created by the fixture, not by the app under test) ... --
    const created = await fetch(`${BENCH_URL}/api/resource/Project`, {
      method: 'POST',
      headers: benchHeaders,
      body: JSON.stringify({ project_name: projectName, company, is_active: 'Yes' }),
    });
    expect(created.status, 'fixture ERP Project must be created on the bench').toBe(200);
    erpProject = String((await created.json()).data.name);

    // The unfiltered candidate list is complete only below its 100-row cap (otherwise no proposal, by design).
    const activeCount = await fetch(
      `${BENCH_URL}/api/method/frappe.client.get_count?doctype=Project&filters=${encodeURIComponent(JSON.stringify([['company', '=', company], ['is_active', '=', 'Yes']]))}`,
      { headers: benchHeaders },
    );
    expect(Number((await activeCount.json()).message), 'the bench must hold <100 active Projects for the Company so the candidate list is complete').toBeLessThan(100);
    const projectsBefore = await erpProjectCount();

    // ... and a dedicated synthetic delivery project in PMO, not yet linked.
    const { error: insertError } = await admin
      .from('projects')
      .insert({ id: projectId, org_id: ORG_ID, name: projectName, status: 'Ongoing Project' });
    expect(insertError).toBeNull();

    // -- When: the Admin reviews the proposed match and confirms it explicitly. --
    await login(page, ADMIN_EMAIL);
    await page.goto('/administration/integrations');
    const review = page.getByRole('region', { name: 'Review existing ERP project matches' });
    await expect(review).toBeVisible({ timeout: 60_000 });
    const row = review.getByRole('listitem').filter({ hasText: projectName });

    await expect(row.getByText(`Suggested exact match: ${projectName} (${erpProject})`)).toBeVisible({ timeout: 30_000 });
    // Nothing is linked until the Admin chooses and confirms — the proposal alone writes nothing.
    await row.getByRole('button', { name: `Use suggested match for ${projectName}` }).click();
    await review.getByRole('button', { name: 'Review selected links' }).click();

    const dialog = page.getByRole('dialog', { name: 'Confirm ERP project matches' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(`${projectName}: No current ERP Project → ${erpProject}`);
    await dialog.getByRole('button', { name: 'Confirm links' }).click();
    await expect(review.getByText('1 links saved; 0 need attention.')).toBeVisible({ timeout: 60_000 });

    // -- Then: after a hard reload the queue no longer proposes the project ... --
    await page.reload();
    await expect(page.getByRole('button', { name: 'Refresh checklist' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(projectName)).toHaveCount(0);
    const readiness = await fetch(`${FUNCTIONS_URL}/functions/v1/external-set-company`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tier: 'erpnext', setupAction: 'readiness' }),
    });
    expect(readiness.status).toBe(200);
    const queue = (await readiness.json()) as { unmappedProjects: Array<{ id: string }> };
    expect(queue.unmappedProjects.map((p) => p.id)).not.toContain(projectId);

    // ... the confirmed target persisted (shown on the project, stored in the ERP project map) ...
    await page.goto(`/projects/${projectId}`);
    // The ERP link lives in the rail's collapsed "Project details and actions" disclosure — open it as a user would.
    await page.locator('summary:visible').filter({ hasText: 'Project details and actions' }).click();
    await expect(
      page
        .locator('section[aria-labelledby="project-erp-match-heading"]:visible')
        .getByText(erpProject, { exact: true })
        .first(),
    ).toBeVisible({ timeout: 60_000 });
    const { data: stored, error: storedError } = await admin
      .from('external_org_bindings')
      .select('config')
      .eq('org_id', ORG_ID)
      .eq('external_tier', 'erpnext')
      .single();
    expect(storedError).toBeNull();
    expect(stored?.config.project_map[projectId]).toBe(erpProject);

    // ... and the review created no ERP Project; the chosen one is still the original, unchanged.
    expect(await erpProjectCount()).toBe(projectsBefore);
    const readback = await fetch(`${BENCH_URL}/api/resource/Project/${encodeURIComponent(erpProject)}`, { headers: benchHeaders });
    expect(readback.status).toBe(200);
    expect((await readback.json()).data).toMatchObject({ name: erpProject, project_name: projectName, company, is_active: 'Yes' });
  } finally {
    // Shared-stack hygiene: restore the binding's project map, drop the PMO project and the ERP fixture.
    const { error: restoreError } = await admin
      .from('external_org_bindings')
      .update({ config: binding!.config })
      .eq('org_id', ORG_ID)
      .eq('external_tier', 'erpnext');
    expect(restoreError).toBeNull();
    const { error: deleteError } = await admin.from('projects').delete().eq('id', projectId);
    expect(deleteError).toBeNull();
    if (erpProject) {
      const removed = await fetch(`${BENCH_URL}/api/resource/Project/${encodeURIComponent(erpProject)}`, {
        method: 'DELETE',
        headers: benchHeaders,
      });
      expect(removed.ok).toBe(true);
    }
  }
});
