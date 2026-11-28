// @e2e-isolation: self-isolated — the journey creates its own organisation (with the sales-pipeline module off), its own client and a disposable Project Manager login per run, and deletes exactly those rows in afterEach; no shared seed row is read or mutated.
import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { jobRoleUser } from './support/jobRole';
import { need, ok, serviceClient, sqlAsOwner } from './support/jobFixtures';
import { stubErpProjectSync, visibleToast } from './helpers';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * AC-3023 (#3023) — the ONE curated cross-stack journey: an organisation whose sales-pipeline
 * module is OFF can still take a new project from a Lead to Ongoing Project on the screen,
 * with no pipeline stage anywhere.
 *
 * The job (Project Manager role, per the issue's acceptance and the role-job rule): create a
 * project at /projects/new, win the Lead from the deal band (customer contract reference +
 * date), then start it — Won, Pending KoM → Ongoing Project — through the status control.
 *
 * The feature-off state is REAL on the server (an org_features override row for this run's own
 * organisation), because transition_project and project_win_eligibility consult the database
 * resolver — a routed read could not fake the enforcement. The database-side rule is owned by
 * supabase/tests/project_ongoing_without_pipeline.test.sql (AC-3023).
 */

test.setTimeout(180_000);

test('AC-3023: a Project Manager in a pipeline-off organisation creates a project and starts it — Lead → Won, Pending KoM → Ongoing Project with no pipeline stage', async ({ page }: { page: Page }) => {
  const admin: SupabaseClient = serviceClient('AC-3023');
  const run = `ac3023-${Date.now().toString(36)}`;
  const orgId = randomUUID();
  const projectName = `${run} interior fit-out`;
  const clientName = `Client ${run}`;

  // The run's own organisation, with the sales-pipeline module switched off.
  ok('organisation', await admin.from('organizations').insert({ id: orgId, name: `Pipeline-Off Org ${run}` }));
  // The service role only reads org_features (plan resolution owns its writes), so the override is set as the database owner.
  sqlAsOwner(`insert into public.org_features (org_id, feature_key, enabled) values ('${orgId}', 'sales_pipeline', false);`);
  const client = need('client', await admin.from('companies')
    .insert({ org_id: orgId, name: clientName, type: 'Client' })
    .select('id')
    .single());
  const pm = await jobRoleUser({ jobRole: 'Project Manager', org: orgId, service: admin, run, displayName: `PM ${run}` });

  let projectId: string | null = null;
  try {
    await pm.signIn(page);
    await stubErpProjectSync(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    // 1 — The PM creates the project (the org's own client and themselves as manager).
    await page.goto('/projects/new');
    await page.getByLabel(/project name/i).fill(projectName);
    await page.getByRole('combobox', { name: /client company/i }).click();
    await expect(page.getByRole('option', { name: clientName })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('option', { name: clientName }).click();
    await page.getByRole('combobox', { name: /project manager/i }).click();
    await expect(page.getByRole('option', { name: `PM ${run}` })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('option', { name: `PM ${run}` }).click();

    // The number is proposed for the client; if this org has no segment yet, the field stays
    // editable and the PM types one — the create requires a number either way.
    const numberField = page.getByLabel(/PMO Project Number/i);
    let proposed = '';
    for (let i = 0; i < 16 && !proposed; i++) {
      proposed = (await numberField.inputValue().catch(() => '')).trim();
      if (!proposed) await page.waitForTimeout(500);
    }
    if (!proposed) await numberField.fill(`PMO-${run}`);

    await page.getByRole('button', { name: /^Create project$/i }).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}/u, { timeout: 30_000 });
    await expect(visibleToast(page, 'Project created')).toBeVisible({ timeout: 15_000 });
    projectId = /\/projects\/([0-9a-f-]{36})/u.exec(page.url())?.[1] ?? null;
    expect(projectId).toBeTruthy();

    // 2 — Win the Lead from the deal band: the primary action is the direct win, NOT a stage
    // advance (there is no pipeline to advance through). The preflight allows it server-side.
    const markWon = page.getByRole('button', { name: 'Mark won' });
    await expect(markWon).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: /Advance to/i })).toHaveCount(0);
    await markWon.click();
    await page.getByLabel(/customer contract reference/i).fill('CPO-3023');
    await page.getByLabel(/contract date/i).fill('2026-01-15');
    await page.getByRole('button', { name: /Confirm won/i }).click();
    await expect(visibleToast(page, /Moved to Won, pending kickoff/i)).toBeVisible({ timeout: 20_000 });

    // 3 — Start it: the ordinary Won, Pending KoM → Ongoing Project move through the status menu.
    await page.getByRole('button', { name: /change status/i }).first().click();
    await page.getByRole('button', { name: 'Ongoing', exact: true }).click();
    await page.getByRole('button', { name: /Move to Ongoing/i }).click();
    await expect(visibleToast(page, /Moved to Ongoing/i)).toBeVisible({ timeout: 20_000 });

    // GOAL ORACLE: after a reload the record is genuinely Ongoing with the win artifacts.
    await page.reload();
    await expect(page.getByText('CPO-3023').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('body').getByText(/^Ongoing$/)).toBeVisible({ timeout: 20_000 });
  } finally {
    // Delete exactly what this run created (the project, then the person, the client, the
    // feature override, the organisation).
    if (projectId) ok('project cleanup', await admin.from('projects').delete().eq('id', projectId));
    try { await pm.cleanup(); } catch (e) { console.warn('AC-3023 profile cleanup:', e); }
    ok('client cleanup', await admin.from('companies').delete().eq('id', client.id as string));
    sqlAsOwner(`delete from public.org_features where org_id = '${orgId}';`);
    ok('organisation cleanup', await admin.from('organizations').delete().eq('id', orgId));
  }
});
