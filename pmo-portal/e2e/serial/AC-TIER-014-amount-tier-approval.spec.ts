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

let admin: SupabaseClient | undefined;
let procurementId = '';
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
  fail('approvers', (await admin.from('spend_approvers').delete().eq('org_id', ORG_ID).is('project_id', null).in('profile_id', [BASE_ID, FINANCE_ID])).error);
  if (priorTiers === null) fail('setting', (await admin.from('spend_approval_settings').delete().eq('org_id', ORG_ID)).error);
  else fail('setting', (await admin.from('spend_approval_settings').update({ tiers_enabled: priorTiers }).eq('org_id', ORG_ID)).error);
  procurementId = '';
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
});
