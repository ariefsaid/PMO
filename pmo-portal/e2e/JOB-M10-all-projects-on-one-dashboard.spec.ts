// @e2e-isolation: self-isolated — owns its Executive login, two contracts and their invoices; deletes them in finally. The revenue
// entitlement is granted by rewriting this page's org_features read (as AC-WIH-017 does), never a shared row.
// JOB-M10 (acceptance 01-management, TC-M-10): all projects on one view. Two contracts with billing: the Executive sees both
// with their value, what is billed and what is left to bill.
// The Dashboard's project portfolio carries value and billed per project; Reports (the management pack) also carries left to bill.
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ok, ORG_ID, runId, serviceClient } from './support/jobFixtures';
import { orgToday } from './support/jobJourney';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(120_000);

type Actor = Awaited<ReturnType<typeof roleJobUser>>;
let admin: SupabaseClient;
let actor: Actor | undefined;
let projectIds: string[] = []; let invoiceIds: string[] = [];

test.afterEach(async () => {
  if (!admin) return;
  if (invoiceIds.length) ok('invoice cleanup', await admin.from('sales_invoices').delete().in('id', invoiceIds));
  if (projectIds.length) {
    await admin.from('record_changes').delete().in('entity_id', projectIds);
    ok('project cleanup', await admin.from('projects').delete().in('id', projectIds));
  }
  await actor?.cleanup();
  projectIds = []; invoiceIds = []; actor = undefined;
});

test('JOB-M10 the Executive sees both contracts with their value, billed and left to bill', async ({ page }) => {
  admin = serviceClient('JOB-M10');
  const run = runId('JOBM10');
  actor = await roleJobUser(admin, 'executive', run);
  const contracts = [
    { name: `${run} alpha`, value: 300_000, billed: 100_000 },
    { name: `${run} beta`, value: 150_000, billed: 50_000 },
  ];
  for (const c of contracts) {
    const project = await admin.from('projects').insert({
      org_id: ORG_ID, name: c.name, status: 'Ongoing Project', currency: 'USD', contract_value: c.value,
      tax_treatment: 'exclusive', tax_amount: 0,
    }).select('id').single();
    if (project.error) throw new Error('project: ' + project.error.message);
    projectIds.push(project.data.id as string);
    const invoice = await admin.from('sales_invoices').insert({
      org_id: ORG_ID, project_id: project.data.id, amount: c.billed, currency: 'USD', tax_treatment: 'exclusive',
      tax_amount: 0, status: 'Unpaid', invoice_date: orgToday(), si_number: `SI-${c.name}`,
    }).select('id').single();
    if (invoice.error) throw new Error('invoice: ' + invoice.error.message);
    invoiceIds.push(invoice.data.id as string);
  }

  await actor.signIn(page);
  await page.route('**/rest/v1/org_features*', async (route) => {
    const response = await route.fetch({ maxRetries: 2 });
    if (!response.ok()) { await route.fulfill({ response }); return; }
    const rows = (await response.json()) as Array<{ feature_key?: string; enabled?: boolean }>;
    await route.fulfill({ response, json: [...rows.filter((r) => r.feature_key !== 'revenue'), { feature_key: 'revenue', enabled: true }] });
  });

  // The portfolio table is the organisation's "management views" setting (off by default; an Admin turns it on). Read it as on for this page only.
  await page.route('**/rest/v1/organizations?*', async (route) => {
    if (route.request().method() !== 'GET' || !/management_views_enabled/.test(route.request().url())) { await route.fallback(); return; }
    const response = await route.fetch();
    if (!response.ok()) { await route.fulfill({ response }); return; }
    const rows = (await response.json()) as Array<Record<string, unknown>>;
    await route.fulfill({ response, json: rows.map((r) => ({ ...r, management_views_enabled: true })) });
  });
  // The executive's dashboard, then the one table that lists every project with its money.
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 30_000 });
  // TC-M-10: the dashboard's project portfolio lists every project with its contract value and what is billed.
  const portfolio = page.getByTestId('project-portfolio-table');
  await expect(portfolio).toBeVisible({ timeout: 30_000 });
  for (const c of contracts) {
    const row = portfolio.getByRole('row').filter({ hasText: c.name }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    const grouped = (n: number) => new RegExp(n.toLocaleString('en-US').replace(/,/g, '[.,\\s]?'));
    await expect(row).toContainText(grouped(c.value));
    await expect(row).toContainText(grouped(c.billed));
  }
  await page.goto('/finance/reports');
  await expect(page.getByTestId('management-pack-table-card')).toBeVisible({ timeout: 30_000 });

  for (const c of contracts) {
    const row = page.getByRole('row').filter({ hasText: c.name }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    const amount = (n: number) => new RegExp(n.toLocaleString('en-US').replace(/,/g, '[.,\\s]?')); // any group separator
    await expect(row).toContainText(amount(c.value));                // contract value
    await expect(row).toContainText(amount(c.billed));               // invoiced
    await expect(row).toContainText(amount(c.value - c.billed));     // left to bill
  }
});
