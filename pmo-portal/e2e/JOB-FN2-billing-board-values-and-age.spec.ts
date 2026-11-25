// @e2e-isolation: self-isolated — owns a client, three projects and three claims with their own named steps, and cleans them up.
/**
 * JOB-FN2-BOARD — the Finance Manager opens Billing -> Board and each step column shows the value of the claims
 * waiting there and how long each has waited. Goal oracle: three claims at three steps each land in their own
 * column, the column carries their money total, and the card states its days on that step.
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { requireServiceRoleKey } from './helpers';
import { inDays } from './support/jobJourney';
import { roleJobUser } from './support/roleJobUser';
import { runId, serviceClient } from './support/jobFixtures';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const VITE_ENV = loadEnv('development', process.cwd(), 'VITE_');
const SUPABASE_URL = requireMatchingLocalSupabaseUrls(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_URL ?? VITE_ENV.VITE_SUPABASE_URL,
);

test.setTimeout(180_000);

let admin: SupabaseClient | undefined;
let financeManager: Awaited<ReturnType<typeof roleJobUser>>;
const tag = `JOB-FN2B ${Date.now()}`;
const companyIds: string[] = [];
const projectIds: string[] = [];
const claimIds: string[] = [];

test.beforeEach(async () => {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('JOB-FN2-BOARD needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh, which exports it');
  admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  financeManager = await roleJobUser(serviceClient('JOB-FN2-BOARD'), 'finance_manager', runId('fn2b-fm'));
  const actor = await admin.from('profiles').select('id').eq('org_id', ORG_ID).eq('email', 'finance@acme.test').single();
  if (actor.error) throw actor.error;

  // Three claims, one per step, each on its own project so the card's own row is unambiguous.
  const steps: Array<{ waitDays: number; upTo: number; gross: number }> = [
    { waitDays: 8, upTo: 1, gross: 11_000 },
    { waitDays: 5, upTo: 2, gross: 22_000 },
    { waitDays: 2, upTo: 3, gross: 33_000 },
  ];
  const names = [`${tag} first`, `${tag} second`, `${tag} third`];
  for (const [i, step] of steps.entries()) {
    const company = await admin.from('companies').insert({ org_id: ORG_ID, name: `${tag} client ${i + 1}`, type: 'Client' }).select('id').single();
    if (company.error) throw company.error;
    companyIds.push(company.data.id);
    const project = await admin.from('projects').insert({
      org_id: ORG_ID, name: `${tag} project ${i + 1}`, status: 'Ongoing Project', currency: 'IDR', client_id: company.data.id,
      contract_value: 10_000_000, tax_treatment: 'exclusive', tax_amount: 0, tax_rate: 12, tax_base_numerator: 11, tax_base_denominator: 12,
    }).select('id').single();
    if (project.error) throw project.error;
    projectIds.push(project.data.id);
    const claim = await admin.from('progress_claims').insert({
      org_id: ORG_ID, project_id: project.data.id, kind: 'progress', currency: 'IDR', gross_amount: step.gross, created_by: actor.data.id,
    }).select('id').single();
    if (claim.error) throw claim.error;
    claimIds.push(claim.data.id);
    const started = inDays(-step.waitDays);
    const rows = names.map((name, position) => ({
      org_id: ORG_ID, claim_id: claim.data.id, project_id: project.data.id, position: position + 1, name, client_side: false,
      started_on: position + 1 <= step.upTo ? started : null,
      completed_on: position + 1 < step.upTo ? started : null,
      completed_by: position + 1 < step.upTo ? actor.data.id : null,
    }));
    const made = await admin.from('claim_billing_stages').insert(rows);
    if (made.error) throw made.error;
  }
});

test.afterEach(async () => {
  if (!admin) return;
  const fail = (step: string, e: { message: string } | null) => { if (e) throw new Error(`JOB-FN2-BOARD cleanup ${step}: ${e.message}`); };
  if (claimIds.length) { fail('stages', (await admin.from('claim_billing_stages').delete().in('claim_id', claimIds)).error); fail('claims', (await admin.from('progress_claims').delete().in('id', claimIds)).error); claimIds.length = 0; }
  if (projectIds.length) { fail('projects', (await admin.from('projects').delete().in('id', projectIds)).error); projectIds.length = 0; }
  if (companyIds.length) { fail('companies', (await admin.from('companies').delete().in('id', companyIds)).error); companyIds.length = 0; }
  await financeManager.cleanup();
});

test('JOB-FN2 a Finance Manager reads each billing step with its value and its claims age', async ({ page }) => {
  // 1. The Finance Manager opens Billing -> Board.
  await financeManager.signIn(page);
  await page.goto('/finance/billing-board');

  // 2. Each step shows its value and the age of the claim waiting there.
  const expectations = [
    { name: `${tag} first`, amount: /11[.,]000/, days: /8/ },
    { name: `${tag} second`, amount: /22[.,]000/, days: /5/ },
    { name: `${tag} third`, amount: /33[.,]000/, days: /2/ },
  ];
  for (const expected of expectations) {
    const column = page.getByTestId('billing-board-column').filter({ has: page.getByRole('heading', { name: expected.name }) });
    await expect(column).toBeVisible({ timeout: 20_000 });
    await expect(column.getByTestId('billing-board-column-totals')).toContainText(expected.amount);
    // The value reads as grouped money with the currency named once, not the raw exact string.
    await expect(column.getByTestId('billing-board-column-totals')).not.toContainText(/\d{5}\.00/);
    const card = column.getByTestId('billing-board-card');
    await expect(card).toHaveCount(1);
    await expect(card.getByTestId('billing-board-age')).toContainText(expected.days);
  }
});
