// @e2e-isolation: self-isolated — creates its own uniquely-titled expense claim (and the follow-up task it makes) each run, and deletes both afterwards; touches no shared seed row.
/**
 * AC-RLT-017 — record-linked tasks (#2587): the one cross-stack journey. The claimant opens their approved expense
 * claim, makes a follow-up task from it (the task is theirs); Finance, who is not that task's editor, pays the claim;
 * the claimant then finds the task Done in My tasks with the reason "the expense claim is Paid".
 * Goal oracle: nobody keeps chasing something already finished, and nothing but the record's own status closed it.
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { signIn, requireServiceRoleKey } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const PM_ID = '00000000-0000-0000-0000-0000000000a2'; // approved the claim (so Finance, not the approver, pays it)
const ENGINEER_ID = '00000000-0000-0000-0000-0000000000a4';
const VITE_ENV = loadEnv('development', process.cwd(), 'VITE_');
const SUPABASE_URL = requireMatchingLocalSupabaseUrls(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_URL ?? VITE_ENV.VITE_SUPABASE_URL,
);

test.setTimeout(120_000);

let admin: SupabaseClient | undefined;
let claimId = '';
let tag = '';

test.beforeEach(async () => {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-RLT-017 needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh, which exports it');
  admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  tag = `RLT-017 ${Date.now()}`;
  const claim = await admin.from('expense_claims').insert({
    org_id: ORG_ID, claimant_id: ENGINEER_ID, project_id: null, currency: 'IDR', amount: 250_000, status: 'Approved',
    approved_by_id: PM_ID, approved_at: new Date().toISOString(), title: tag,
  }).select('id').single();
  if (claim.error) throw new Error(`AC-RLT-017 fixture claim: ${claim.error.message}`);
  claimId = claim.data.id;
});

test.afterEach(async () => {
  if (!admin || !claimId) return;
  const fail = (step: string, e: { message: string } | null) => { if (e) throw new Error(`AC-RLT-017 cleanup ${step}: ${e.message}`); };
  // The task names the claim (an FK that blocks its hard delete): clear the task first.
  fail('tasks', (await admin.from('tasks').delete().eq('expense_claim_id', claimId)).error);
  fail('claim', (await admin.from('expense_claims').delete().eq('id', claimId)).error);
  claimId = '';
});

test('AC-RLT-017 paying the claim closes the follow-up task, and its owner sees why in My tasks', async ({ page }) => {
  // The claimant makes the follow-up from the claim itself.
  await signIn(page, 'engineer@acme.test');
  await page.goto(`/expenses/${claimId}`);
  await page.getByRole('button', { name: 'Create follow-up task' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/What needs following up/).fill(`${tag} chase the payment`);
  await dialog.getByRole('button', { name: 'Create task' }).click();
  // Once one is open the claim offers that task, never a second.
  await expect(page.getByRole('link', { name: 'Open follow-up task' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Create follow-up task' })).toHaveCount(0);

  // Finance pays the claim: not the task's creator, assignee or editor.
  await signIn(page, 'finance@acme.test');
  await page.goto(`/expenses/${claimId}`);
  await page.getByRole('button', { name: 'Mark paid' }).click();
  const pay = page.getByRole('dialog');
  await pay.getByLabel('Payment reference (optional)').fill(`TRF-${Date.now()}`);
  await pay.getByRole('button', { name: 'Mark paid', exact: true }).click();
  await expect(page.getByTestId('expense-status')).toHaveAttribute('data-status', 'Paid', { timeout: 15_000 });

  // The claimant finds the task Done, with the reason.
  await signIn(page, 'engineer@acme.test');
  await page.goto('/my-tasks?queue=completed');
  const row = page.getByText(`${tag} chase the payment`).locator('xpath=ancestor::div[contains(@class,"px-4")][1]');
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.getByText(/Closed automatically: the expense claim is Paid/)).toBeVisible();
});
