// @e2e-isolation: serial — transitions seed project P012 to Won, Pending KoM (org-wide on-hand aggregate mutation); restores P012 in afterEach.
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { login, openPipelineCard, requireServiceRoleKey, visibleToast } from '../helpers';

// AC-1011 — Win a deal end-to-end (single curated journey).
//
// Model B (ADR-0020): a pre-win deal lives in the Sales Pipeline and opens at the ONE canonical
// detail route /projects/:id with the PIPELINE lens. A PM wins it there via "Mark won" → the
// inline SoD capture (customer contract ref + date) → Confirm won. The goal-oracle is unchanged:
// after the transition the deal is "Won, Pending KoM" with the entered customer ref, and — now
// that it satisfies the on-hand partition — it appears in the active Projects (delivery) list.
//
// ISOLATION: this journey transitions its deal to 'Won, Pending KoM', which mutates the org-wide
// on-hand project aggregate. Per ADR-0020 / e2e parallel conventions and Director exception,
// this spec runs in the serial lane and always cleans up its owned seed row P012 in test.afterEach.
//
// (FR-PR-001/004/005/011, NFR-PR-UI-001)

test.setTimeout(120_000);

const P012_ID = '40000000-0000-0000-0000-000000000012';
const DEAL_NAME = 'Eastgate Depot Upgrade';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = requireServiceRoleKey();

function getAdminClient(): SupabaseClient {
  if (!SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to restore P012 fixture in AC-1011');
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

async function restoreP012(): Promise<void> {
  const admin = getAdminClient();
  const { error } = await admin.from('projects').update({
    status: 'Tender Submitted',
    customer_contract_ref: null,
    contract_date: null,
    decided_at: null,
  }).eq('id', P012_ID);
  if (error) {
    throw new Error(`Failed to restore P012 fixture: ${error.message}`);
  }
}

test.beforeEach(async () => {
  await restoreP012();
});

test.afterEach(async () => {
  await restoreP012();
});

test('AC-1011: a PM wins a deal — open it from the Pipeline, Mark won, enter customer contract ref + date, confirm; the deal becomes Won and shows in the active Projects list with the entered ref', async ({ page }) => {
  await login(page, 'pm@acme.test');

  // The Tender-stage deal lives in the Sales Pipeline (not the active Projects list).
  await page.goto('/sales');
  await expect(page.getByLabel('Sales pipeline board')).toBeVisible({ timeout: 15_000 });

  // Model B: the deal opens at the canonical /projects/:id route with the pipeline lens.
  // openPipelineCard retries the click until that route is reached — the board re-renders as the
  // pipeline query resolves, so a click→navigate fired pre-hydration can be swallowed under load.
  await openPipelineCard(page, DEAL_NAME);
  // CW-1 r2fix-enforce: "Deal stage journey" → "Project stage journey"
  await expect(page.getByLabel('Project stage journey')).toBeVisible({ timeout: 15_000 });

  // Mark won → the inline SoD capture (no modal) reveals contract ref + date.
  await page.getByRole('button', { name: /Mark won/i }).click();
  await page.getByLabel(/customer contract reference/i).fill('CPO-E2E-1');
  await page.getByLabel(/contract date/i).fill('2026-04-01');
  await page.getByRole('button', { name: /Confirm won/i }).click();

  // The user sees the win acknowledged (success toast) before moving on — wait for it so the
  // transition has committed + the caches invalidated before we navigate away (natural journey:
  // you read the confirmation, then go look at your projects).
  await expect(visibleToast(page, /Won, Pending KoM/i)).toBeVisible({
    timeout: 15_000,
  });

  // GOAL ORACLE: the deal is now Won, Pending KoM and appears in the active Projects list
  // (it satisfies the on-hand partition) with the entered customer contract ref.
  await page.goto('/projects');
  await expect(page.getByTestId('projects-loading')).not.toBeVisible({ timeout: 15_000 });
  const wonRow = page.getByRole('row').filter({ hasText: DEAL_NAME });
  await expect(wonRow).toBeVisible({ timeout: 15_000 });
  await expect(wonRow.getByText('Won, Pending KoM')).toBeVisible({ timeout: 15_000 });
  // PL-A: the list no longer repeats references per row; the contract ref lives on the record.
  await expect(wonRow.getByText('More project references')).toHaveCount(0);
  await wonRow.getByRole('button', { name: DEAL_NAME }).click();
  await page.getByLabel('More actions').click();
  await page.getByRole('button', { name: 'Project details', exact: true }).click();
  await expect(page.getByText('CPO-E2E-1').first()).toBeVisible({ timeout: 10_000 });
});
