// @e2e-isolation: serial — turns the organisation's approval tiers on and adds org-wide (overhead) approver rows, then restores both in afterEach.
/**
 * AC-TIER-014 — approval by amount tiers (#2695): the one cross-stack journey. The tier the server enforces
 * (pgTAP AC-TIER-003) is what the person in front of the request sees.
 * Goal oracle: with tiers on, an overhead request of a large amount is decided only by the higher-tier approver;
 * the base-tier approver is told who decides and offered no Approve; the higher-tier approver approves it.
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { signIn, requireServiceRoleKey } from '../helpers';
import { requireMatchingLocalSupabaseUrls } from '../../src/lib/testing/localSupabaseUrl';

const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
// An Executive, not a Project Manager: a PM sees only procurements they raised or on a project they manage, so an overhead request is outside a PM's scope.
const BASE_ID = '00000000-0000-0000-0000-0000000000a1'; // base tier
const FINANCE_ID = '00000000-0000-0000-0000-0000000000a3'; // the 100000 tier
const ENGINEER_ID = '00000000-0000-0000-0000-0000000000a4'; // the requester
const VITE_ENV = loadEnv('development', process.cwd(), 'VITE_');
const SUPABASE_URL = requireMatchingLocalSupabaseUrls(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_URL ?? VITE_ENV.VITE_SUPABASE_URL,
);

test.setTimeout(90_000);
test.use({ deviceScaleFactor: 2 });
const EVIDENCE = '../docs/evidence/1215/2695';
const shots = async (page: import('@playwright/test').Page, locator: import('@playwright/test').Locator, name: string) => {
  for (const [label, width, height] of [['phone', 390, 844], ['desktop', 1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    await locator.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${EVIDENCE}/${name}-${label}.png`, fullPage: true });
  }
};

let admin: SupabaseClient | undefined;
let procurementId = '';
let projectId = '';
let projectRequestId = '';
let priorTiers: boolean | null = null;
let approverName = '';

test.beforeEach(async () => {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-TIER-014 needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh, which exports it');
  admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  const tag = `TIER-014 ${Date.now()}`;

  const settings = await admin.from('spend_approval_settings').select('tiers_enabled').eq('org_id', ORG_ID).maybeSingle();
  if (settings.error) throw new Error(`AC-TIER-014 fixture read setting: ${settings.error.message}`);
  priorTiers = settings.data ? settings.data.tiers_enabled : null;
  const on = await admin.from('spend_approval_settings').upsert({ org_id: ORG_ID, tiers_enabled: true }, { onConflict: 'org_id' });
  if (on.error) throw new Error(`AC-TIER-014 fixture tiers on: ${on.error.message}`);

  const named = await admin.from('profiles').select('full_name').eq('id', FINANCE_ID).single();
  if (named.error) throw new Error(`AC-TIER-014 fixture approver name: ${named.error.message}`);
  approverName = named.data.full_name;

  const rows = await admin.from('spend_approvers').insert([
    { org_id: ORG_ID, project_id: null, profile_id: BASE_ID, min_amount: null },
    { org_id: ORG_ID, project_id: null, profile_id: FINANCE_ID, min_amount: 100_000 },
  ]);
  if (rows.error) throw new Error(`AC-TIER-014 fixture approvers: ${rows.error.message}`);

  const pr = await admin
    .from('procurements')
    .insert({ org_id: ORG_ID, title: `${tag} generator`, project_id: null, requested_by_id: ENGINEER_ID, status: 'Requested', total_value: 400_000 })
    .select('id')
    .single();
  if (pr.error) throw new Error(`AC-TIER-014 fixture procurement: ${pr.error.message}`);
  procurementId = pr.data.id;

  // A second request, on a project with an Active budget line, so the request page has budget figures to show.
  const project = await admin.from('projects').insert({ org_id: ORG_ID, name: tag, status: 'Ongoing Project' }).select('id').single();
  if (project.error) throw new Error(`AC-TIER-014 fixture project: ${project.error.message}`);
  projectId = project.data.id;
  const version = await admin.from('budget_versions').insert({ org_id: ORG_ID, project_id: projectId, name: tag, version: 1, status: 'Draft' }).select('id').single();
  if (version.error) throw new Error(`AC-TIER-014 fixture budget version: ${version.error.message}`);
  const line = await admin.from('budget_line_items').insert({ org_id: ORG_ID, budget_version_id: version.data.id, category: 'Materials', budgeted_amount: 1_000_000 });
  if (line.error) throw new Error(`AC-TIER-014 fixture budget line: ${line.error.message}`);
  const activate = await admin.from('budget_versions').update({ status: 'Active' }).eq('id', version.data.id);
  if (activate.error) throw new Error(`AC-TIER-014 fixture budget activate: ${activate.error.message}`);
  const projectRequest = await admin
    .from('procurements')
    .insert({ org_id: ORG_ID, title: `${tag} cable`, project_id: projectId, requested_by_id: ENGINEER_ID, status: 'Requested', total_value: 50_000, budget_category: 'Materials' })
    .select('id')
    .single();
  if (projectRequest.error) throw new Error(`AC-TIER-014 fixture project request: ${projectRequest.error.message}`);
  projectRequestId = projectRequest.data.id;
});

test.afterEach(async () => {
  if (!admin) return;
  const fail = (step: string, e: { message: string } | null) => {
    if (e) throw new Error(`AC-TIER-014 cleanup ${step}: ${e.message}`);
  };
  if (procurementId) {
    fail('events', (await admin.from('procurement_status_events').delete().eq('procurement_id', procurementId)).error);
    fail('procurement', (await admin.from('procurements').delete().eq('id', procurementId)).error);
  }
  if (projectRequestId) {
    fail('project request events', (await admin.from('procurement_status_events').delete().eq('procurement_id', projectRequestId)).error);
    fail('project request', (await admin.from('procurements').delete().eq('id', projectRequestId)).error);
  }
  if (projectId) {
    // Line items go by cascade: a direct delete is refused by budget_line_items_draft_guard (Active).
    fail('versions', (await admin.from('budget_versions').delete().eq('project_id', projectId)).error);
    fail('project', (await admin.from('projects').delete().eq('id', projectId)).error);
  }
  fail('approvers', (await admin.from('spend_approvers').delete().eq('org_id', ORG_ID).is('project_id', null).in('profile_id', [BASE_ID, FINANCE_ID])).error);
  if (priorTiers === null) fail('setting', (await admin.from('spend_approval_settings').delete().eq('org_id', ORG_ID)).error);
  else fail('setting', (await admin.from('spend_approval_settings').update({ tiers_enabled: priorTiers }).eq('org_id', ORG_ID)).error);
  procurementId = '';
  projectId = '';
  projectRequestId = '';
});

test('AC-TIER-014 a large overhead request is decided by the higher tier, and only by them', async ({ page }) => {
  // The base-tier approver: told who decides, offered no Approve.
  await signIn(page, 'exec@acme.test');
  await page.goto(`/procurement/${procurementId}`);
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Requested', { timeout: 10_000 });
  await expect(page.getByTestId('approval-route-note')).toContainText(approverName);
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);

  // The higher-tier approver decides it.
  await signIn(page, 'finance@acme.test');
  await page.goto(`/procurement/${procurementId}`);
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Approved', { timeout: 15_000 });

  // Evidence (#2695): the request page decision strip with the budget used, and the spend approvers card with tiers on.
  await signIn(page, 'exec@acme.test');
  await page.goto(`/procurement/${projectRequestId}`);
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  const strip = page.getByTestId('sod-ready-hint');
  await strip.waitFor({ state: 'visible', timeout: 15_000 });
  await shots(page, strip, 'request-budget-used');

  await signIn(page, 'admin@acme.test');
  await page.goto('/administration/accounting');
  const card = page.locator('#spend-approvers');
  await card.waitFor({ state: 'visible', timeout: 15_000 });
  await shots(page, card, 'spend-approvers-tiers');
});
