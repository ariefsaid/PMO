// @e2e-isolation: self-isolated — owns a client, project, claim and its steps (named with a unique tag) and cleans them up.
/**
 * AC-BBD-016 — #2681, the one cross-stack journey for the billing board. Finance opens the board from the Receivables header, finds the
 * claim as a card under its current step with its age, and opens it: the card lands on the claim's project. Goal oracle: the claim is
 * on the board under the step it is actually at, and the card leads to the claim.
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { signIn, requireServiceRoleKey } from './helpers';
import { inDays } from './support/jobJourney';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const VITE_ENV = loadEnv('development', process.cwd(), 'VITE_');
const SUPABASE_URL = requireMatchingLocalSupabaseUrls(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_URL ?? VITE_ENV.VITE_SUPABASE_URL,
);

test.setTimeout(120_000);

let admin: SupabaseClient | undefined;
let projectId = '';
let companyId = '';
let claimId = '';
let tag = '';

test.beforeEach(async () => {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-BBD-016 needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh, which exports it');
  admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  tag = `AC-BBD-016 ${Date.now()}`;
  const company = await admin.from('companies').insert({ org_id: ORG_ID, name: `${tag} Client`, type: 'Client' }).select('id').single();
  if (company.error) throw new Error(`AC-BBD-016 fixture company: ${company.error.message}`);
  companyId = company.data.id;
  const project = await admin.from('projects').insert({
    org_id: ORG_ID, name: tag, status: 'Ongoing Project', currency: 'IDR', client_id: companyId,
    contract_value: 10_000_000, tax_treatment: 'exclusive', tax_amount: 0, tax_rate: 12, tax_base_numerator: 11, tax_base_denominator: 12,
  }).select('id').single();
  if (project.error) throw new Error(`AC-BBD-016 fixture project: ${project.error.message}`);
  projectId = project.data.id;
  const finance = await admin.from('profiles').select('id').eq('org_id', ORG_ID).eq('email', 'finance@acme.test').single();
  if (finance.error) throw new Error(`AC-BBD-016 fixture finance user: ${finance.error.message}`);
  const claim = await admin.from('progress_claims').insert({
    org_id: ORG_ID, project_id: projectId, kind: 'progress', currency: 'IDR', gross_amount: 1000, created_by: finance.data.id,
  }).select('id').single();
  if (claim.error) throw new Error(`AC-BBD-016 fixture claim: ${claim.error.message}`);
  claimId = claim.data.id;
  const started = inDays(-4); // the organisation's calendar day, as the board counts age
  const steps = await admin.from('claim_billing_stages').insert([
    { org_id: ORG_ID, claim_id: claimId, project_id: projectId, position: 1, name: `${tag} first`, client_side: false, started_on: started, completed_on: started, completed_by: finance.data.id },
    { org_id: ORG_ID, claim_id: claimId, project_id: projectId, position: 2, name: `${tag} second`, client_side: false, started_on: started },
  ]);
  if (steps.error) throw new Error(`AC-BBD-016 fixture steps: ${steps.error.message}`);
});

test.afterEach(async () => {
  if (!admin) return;
  const fail = (step: string, e: { message: string } | null) => { if (e) throw new Error(`AC-BBD-016 cleanup ${step}: ${e.message}`); };
  if (claimId) {
    fail('claim', (await admin.from('progress_claims').delete().eq('id', claimId)).error);
    claimId = '';
  }
  if (projectId) { fail('project', (await admin.from('projects').delete().eq('id', projectId)).error); projectId = ''; }
  if (companyId) { fail('company', (await admin.from('companies').delete().eq('id', companyId)).error); companyId = ''; }
});

test('AC-BBD-016 Finance finds the claim under its current step on the billing board and opens it', async ({ page }) => {
  await signIn(page, 'finance@acme.test');
  await page.goto('/finance/receivables');
  await page.getByTestId('receivables-billing-board-link').click();
  await expect(page).toHaveURL(/\/finance\/billing-board/);

  const column = page.getByTestId('billing-board-column').filter({ has: page.getByRole('heading', { name: `${tag} second` }) });
  await expect(column).toBeVisible({ timeout: 15_000 });
  const card = column.getByTestId('billing-board-card').filter({ hasText: tag });
  await expect(card).toContainText(/1 of 2 steps|1 dari 2 langkah/);
  await expect(card.getByTestId('billing-board-age')).toContainText(/4/);

  await card.click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}`));
});
