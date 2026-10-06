// @e2e-isolation: self-isolated — creates its own uniquely-named project, Active budget, purchase request and project-level approver row each run, and deletes them afterwards; touches no shared seed row.
/**
 * AC-APR-040 — approval routing by budget (#803): the one cross-stack journey. The route the server
 * enforces (pgTAP AC-APR-001/002) is what the person in front of the request sees.
 * Goal oracle: a PM who is NOT the project's named approver is told who decides and offered no
 * Approve; the named approver approves and the request becomes Approved.
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { signIn, requireServiceRoleKey } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const ENGINEER_ID = '00000000-0000-0000-0000-0000000000a4'; // the requester
const FINANCE_ID = '00000000-0000-0000-0000-0000000000a3'; // the named project approver
const VITE_ENV = loadEnv('development', process.cwd(), 'VITE_');
const SUPABASE_URL = requireMatchingLocalSupabaseUrls(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_URL ?? VITE_ENV.VITE_SUPABASE_URL,
);

test.setTimeout(90_000);

let admin: SupabaseClient | undefined;
let projectId = '';
let procurementId = '';
let approverName = '';

test.beforeEach(async () => {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-APR-040 needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh, which exports it');
  admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  const tag = `APR-040 ${Date.now()}`;

  const project = await admin.from('projects').insert({ org_id: ORG_ID, name: tag, status: 'Ongoing Project' }).select('id').single();
  if (project.error) throw new Error(`AC-APR-040 fixture project: ${project.error.message}`);
  projectId = project.data.id;

  const version = await admin
    .from('budget_versions')
    // budget_line_items_draft_guard: lines only land on a Draft version — seed Draft → lines → Active.
    .insert({ org_id: ORG_ID, project_id: projectId, name: tag, version: 1, status: 'Draft' })
    .select('id')
    .single();
  if (version.error) throw new Error(`AC-APR-040 fixture budget version: ${version.error.message}`);

  const line = await admin
    .from('budget_line_items')
    .insert({ org_id: ORG_ID, budget_version_id: version.data.id, category: 'Materials', budgeted_amount: 1_000_000 });
  if (line.error) throw new Error(`AC-APR-040 fixture budget line: ${line.error.message}`);
  const activate = await admin.from('budget_versions').update({ status: 'Active' }).eq('id', version.data.id);
  if (activate.error) throw new Error(`AC-APR-040 fixture budget activate: ${activate.error.message}`);

  // The note must name the approver — read the seed's name rather than hard-code a person.
  const named = await admin.from('profiles').select('full_name').eq('id', FINANCE_ID).single();
  if (named.error) throw new Error(`AC-APR-040 fixture approver name: ${named.error.message}`);
  approverName = named.data.full_name;

  const approver = await admin.from('spend_approvers').insert({ org_id: ORG_ID, project_id: projectId, profile_id: FINANCE_ID });
  if (approver.error) throw new Error(`AC-APR-040 fixture approver: ${approver.error.message}`);

  const pr = await admin
    .from('procurements')
    .insert({
      org_id: ORG_ID,
      title: `${tag} cable`,
      project_id: projectId,
      requested_by_id: ENGINEER_ID,
      status: 'Requested',
      total_value: 400_000,
      budget_category: 'Materials',
    })
    .select('id')
    .single();
  if (pr.error) throw new Error(`AC-APR-040 fixture procurement: ${pr.error.message}`);
  procurementId = pr.data.id;
});

test.afterEach(async () => {
  if (!admin) return;
  const fail = (step: string, e: { message: string } | null) => {
    if (e) throw new Error(`AC-APR-040 cleanup ${step}: ${e.message}`);
  };
  if (procurementId) {
    fail('events', (await admin.from('procurement_status_events').delete().eq('procurement_id', procurementId)).error);
    fail('procurement', (await admin.from('procurements').delete().eq('id', procurementId)).error);
  }
  if (projectId) {
    fail('approvers', (await admin.from('spend_approvers').delete().eq('project_id', projectId)).error);
    // Line items go by cascade: a direct delete is refused by budget_line_items_draft_guard (Active).
    fail('versions', (await admin.from('budget_versions').delete().eq('project_id', projectId)).error);
    fail('project', (await admin.from('projects').delete().eq('id', projectId)).error);
  }
  procurementId = '';
  projectId = '';
});

test('AC-APR-040 a within-budget request is decided by the project approver, and only by them', async ({ page }) => {
  // A PM who is not the named approver: told who decides, offered no Approve.
  await signIn(page, 'pm@acme.test');
  await page.goto(`/procurement/${procurementId}`);
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Requested', { timeout: 10_000 });
  await expect(page.getByTestId('approval-route-note')).toContainText(approverName);
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);

  // The named approver decides it.
  await signIn(page, 'finance@acme.test');
  await page.goto(`/procurement/${procurementId}`);
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Approve' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Approved', { timeout: 15_000 });
});
