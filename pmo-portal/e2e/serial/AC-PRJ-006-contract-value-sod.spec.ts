// @e2e-isolation: serial — an on-hand project changes org-wide money KPIs while this SoD journey runs; a run-scoped row is deleted after each attempt.
import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { login, requireServiceRoleKey } from '../helpers';

// AC-PRJ-006: on a won/on-hand project, Finance can edit contract value through the audit
// confirmation and PM sees the value as read-only. pgTAP 0052 owns the server-side SoD contract.
// A new project per attempt preserves the shared P001 fixture for the locale and dashboard journeys.
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SEED_PROJECT_ID = '40000000-0000-0000-0000-000000000001';
const PROJECT_NAME_PREFIX = 'E2E Contract SoD ';

function adminClient() {
  const host = new URL(SUPABASE_URL).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error('AC-PRJ-006 fixture requires the local Supabase stack');
  }
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-PRJ-006 requires the local Supabase service role key; run through scripts/e2e-local.sh');
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
}

function projectButton(page: Page, name: string) {
  return page.getByRole('button', { name, exact: true });
}

async function waitProjectsReady(page: Page) {
  await expect(page.getByTestId('projects-loading')).not.toBeVisible({ timeout: 20_000 });
}

let projectId: string | undefined;
let projectName: string;

test.setTimeout(120_000);

test.beforeEach(async () => {
  projectId = undefined;
  const admin = adminClient();
  const { data: seed, error: seedError } = await admin
    .from('projects')
    .select('org_id, client_id, project_manager_id')
    .eq('id', SEED_PROJECT_ID)
    .single();
  if (seedError || !seed) throw new Error(`AC-PRJ-006 seed project unavailable: ${seedError?.message}`);

  // Playwright restarts a worker after a failed attempt, so an in-memory set cannot remember
  // an ID whose afterEach cleanup failed. Remove this spec's stale rows from the local stack
  // before every attempt; the name prefix is exclusive to this journey.
  const { error: staleError } = await admin
    .from('projects')
    .delete()
    .eq('org_id', seed.org_id)
    .like('name', `${PROJECT_NAME_PREFIX}%`);
  if (staleError) throw new Error(`AC-PRJ-006 stale fixture cleanup failed: ${staleError.message}`);

  projectId = crypto.randomUUID();
  projectName = `${PROJECT_NAME_PREFIX}${projectId.slice(0, 8)}`;
  const { error } = await admin.from('projects').insert({
    id: projectId,
    org_id: seed.org_id,
    client_id: seed.client_id,
    project_manager_id: seed.project_manager_id,
    name: projectName,
    status: 'Ongoing Project',
    contract_value: 5000000,
    tax_treatment: 'exclusive',
    tax_amount: 0,
    start_date: '2026-01-06',
  });
  if (error) throw new Error(`AC-PRJ-006 setup failed: ${error.message}`);
});

test.afterEach(async () => {
  if (!projectId) return;
  const { error } = await adminClient().from('projects').delete().eq('id', projectId);
  if (error) throw new Error(`AC-PRJ-006 cleanup failed: ${error.message}`);
  projectId = undefined;
});

test(
  'AC-PRJ-006 SoD: on a won project, Finance can edit the contract value and a new figure is recorded; the PM sees it read-only',
  async ({ page }) => {
    // PM view: the value is locked (read-only) on a won project.
    await login(page, 'pm@acme.test');
    await page.goto('/projects');
    await waitProjectsReady(page);
    await projectButton(page, projectName).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}`));
    // GOAL ORACLE: the PM sees the read-only contract rule and has no edit affordance.
    // The lock control stays beside the contract in the compact header in both locales.
    const lockToggle = page.locator('button[aria-controls="contract-value-lock-reason"]');
    await expect(lockToggle).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /Edit contract value/i })).toHaveCount(0);
    await lockToggle.click();
    const lockReason = page.getByTestId('contract-value-lock-reason');
    await expect(lockReason).toBeVisible();
    await expect(lockReason).toContainText(/Once a project is won, the contract value is locked for your role|Setelah proyek menang, nilai kontrak terkunci untuk role Anda/i);

    // Finance view: money authority can edit the value behind the audit confirm.
    await login(page, 'finance@acme.test');
    await page.goto('/projects');
    await waitProjectsReady(page);
    await projectButton(page, projectName).click();
    // The list toolbar also calls its export/import disclosure "More actions". Wait for
    // the detail record to load and scope the menu to its header before opening it (AC-TAG-002).
    const recordHeader = page.getByTestId('record-header');
    await expect(recordHeader).toContainText(projectName);
    const actions = recordHeader.getByRole('button', { name: 'More actions', exact: true });
    await expect(actions).toBeEnabled();
    await actions.click();
    const actionMenu = page.getByRole('menu', { name: 'More actions' });
    await expect(actionMenu).toBeVisible();
    await actionMenu.getByRole('menuitem', { name: /Change contract value/i }).click();
    const valueInput = page.getByRole('textbox', { name: /Contract value/i });
    await valueInput.fill('5250000');
    // The tax basis must travel with the edited amount.
    await page.getByTestId('contract-tax-treatment').selectOption('exclusive');
    await page.getByTestId('contract-tax-amount').fill('577500');
    await page.getByRole('button', { name: /^Save$/i }).click();

    // The audit confirm names the SoD; confirm commits via the RPC.
    const confirm = page.getByRole('dialog');
    await expect(confirm).toContainText(/segregation of duties/i);
    await confirm.getByRole('button', { name: /record/i }).click();

    // GOAL ORACLE: the new value is reflected in the single authoritative Contract read (UIP-006).
    await expect(page.getByTestId('contract-value-amount')).toHaveText(/\$5,250,000/, { timeout: 15_000 });
  },
);
