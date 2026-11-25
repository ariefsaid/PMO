// @e2e-isolation: self-isolated — owns a client, project, claim and its steps (named with a unique tag) and cleans them up.
/**
 * JOB-BQ5-READ — #2681, the one cross-stack journey for the billing board. Finance opens the board from the Receivables header, finds the
 * claim as a card under its current step with its age, and opens it: the card lands on the claim's project. Goal oracle: the claim is
 * on the board under the step it is actually at, and the card leads to the claim.
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { requireServiceRoleKey } from './helpers';
import { inDays } from './support/jobJourney';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const VITE_ENV = loadEnv('development', process.cwd(), 'VITE_');
const SUPABASE_URL = requireMatchingLocalSupabaseUrls(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_URL ?? VITE_ENV.VITE_SUPABASE_URL,
);

test.setTimeout(120_000);

import { moneyJobRole } from "./support/moneyJobRole";
let worker: Awaited<ReturnType<typeof moneyJobRole>>;
let admin: SupabaseClient | undefined;
let projectId = '';
let companyId = '';
let claimId = '';
let tag = '';

test.beforeEach(async () => {
  worker = await moneyJobRole("quantity_surveyor");
  const key = requireServiceRoleKey();
  if (!key) throw new Error('JOB-BQ5-READ needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh, which exports it');
  admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  tag = `JOB-BQ5-READ ${Date.now()}`;
  const company = await admin.from('companies').insert({ org_id: ORG_ID, name: `${tag} Client`, type: 'Client' }).select('id').single();
  if (company.error) throw new Error(`JOB-BQ5-READ fixture company: ${company.error.message}`);
  companyId = company.data.id;
  const project = await admin.from('projects').insert({
    org_id: ORG_ID, name: tag, status: 'Ongoing Project', currency: 'IDR', client_id: companyId,
    contract_value: 10_000_000, tax_treatment: 'exclusive', tax_amount: 0, tax_rate: 12, tax_base_numerator: 11, tax_base_denominator: 12,
  }).select('id').single();
  if (project.error) throw new Error(`JOB-BQ5-READ fixture project: ${project.error.message}`);
  projectId = project.data.id;
  const finance = await admin.from('profiles').select('id').eq('org_id', ORG_ID).eq('email', 'finance@acme.test').single();
  if (finance.error) throw new Error(`JOB-BQ5-READ fixture finance user: ${finance.error.message}`);
  const claim = await admin.from('progress_claims').insert({
    org_id: ORG_ID, project_id: projectId, kind: 'progress', currency: 'IDR', gross_amount: 1000, created_by: finance.data.id,
  }).select('id').single();
  if (claim.error) throw new Error(`JOB-BQ5-READ fixture claim: ${claim.error.message}`);
  claimId = claim.data.id;
  const started = inDays(-4); // the organisation's calendar day, as the board counts age
  const steps = await admin.from('claim_billing_stages').insert([
    { org_id: ORG_ID, claim_id: claimId, project_id: projectId, position: 1, name: `${tag} first`, client_side: false, started_on: started, completed_on: started, completed_by: finance.data.id },
    { org_id: ORG_ID, claim_id: claimId, project_id: projectId, position: 2, name: `${tag} second`, client_side: false, started_on: started },
  ]);
  if (steps.error) throw new Error(`JOB-BQ5-READ fixture steps: ${steps.error.message}`);
});

test.afterEach(async () => {
  await worker?.cleanup();
  if (!admin) return;
  const fail = (step: string, e: { message: string } | null) => { if (e) throw new Error(`JOB-BQ5-READ cleanup ${step}: ${e.message}`); };
  if (claimId) {
    fail('claim', (await admin.from('progress_claims').delete().eq('id', claimId)).error);
    claimId = '';
  }
  if (projectId) { fail('project', (await admin.from('projects').delete().eq('id', projectId)).error); projectId = ''; }
  if (companyId) { fail('company', (await admin.from('companies').delete().eq('id', companyId)).error); companyId = ''; }
});

test('JOB-BQ5-READ Quantity surveyor opens an existing claim with its billing steps', async ({ page }) => {
  await worker.login(page);
  await page.goto(`/projects/${projectId}/contract`);
  await page.getByText("Progress", { exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText(`${tag} second`);
  await expect(page.getByRole("button", { name: "New claim" })).toHaveCount(0);
});
