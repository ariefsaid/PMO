// @e2e-isolation: self-isolated — owns its Executive login, contract, work order and invoice; deletes them in finally. The revenue
// entitlement is granted by rewriting this page's org_features read, as AC-WIH-017 does (no shared row is changed).
// JOB-M8 (acceptance 01-management, TC-M-08): value of work in hand. A contract with billed value: the Executive opens work in
// hand and each work order shows the value left and the months of work it represents. (The acceptance script names
// Projects → Work in hand; the shipped screen is Finance → Work in hand, walk M8.)
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ok, ORG_ID, runId, serviceClient } from './support/jobFixtures';
import { orgToday } from './support/jobJourney';
import { roleJobUser } from './support/roleJobUser';

const pad = (n: number) => String(n).padStart(2, '0');

/** The 15th of the month `back` months before this one, on the organisation's calendar. */
function dayInMonth(back: number): string {
  const org = orgToday(); // the work-in-hand buckets are the organisation's months
  const year = Number(org.slice(0, 4));
  const month = Number(org.slice(5, 7)) - back;
  const shifted = new Date(Date.UTC(year, month - 1, 15));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

test.setTimeout(120_000);

type Actor = Awaited<ReturnType<typeof roleJobUser>>;
let admin: SupabaseClient;
let actor: Actor | undefined;
let projectId = ''; let woId = ''; let invoiceId = '';

test.afterEach(async () => {
  if (!admin) return;
  if (invoiceId) ok('invoice cleanup', await admin.from('sales_invoices').delete().eq('id', invoiceId));
  if (woId) {
    await admin.from('work_order_plan_lines').delete().eq('work_order_id', woId);
    ok('work order cleanup', await admin.from('work_orders').delete().eq('id', woId));
  }
  if (projectId) {
    await admin.from('record_changes').delete().eq('entity_id', projectId);
    ok('project cleanup', await admin.from('projects').delete().eq('id', projectId));
  }
  await actor?.cleanup();
  projectId = ''; woId = ''; invoiceId = ''; actor = undefined;
});

test('JOB-M8 the Executive sees, per work order, the value left to bill and the months of work it represents', async ({ page }) => {
  admin = serviceClient('JOB-M8');
  const run = runId('JOBM8');
  actor = await roleJobUser(admin, 'executive', run);
  projectId = (await admin.from('projects').insert({
    org_id: ORG_ID, name: `${run} contract`, status: 'Ongoing Project', currency: 'USD', contract_value: 300_000,
    tax_treatment: 'exclusive', tax_amount: 0,
  }).select('id').single()).data!.id as string;
  woId = crypto.randomUUID();
  ok('work order', await admin.from('work_orders').insert({
    id: woId, org_id: ORG_ID, project_id: projectId, title: `${run} pipeline`, wo_number: `WO-${run}`, status: 'Issued',
    issued_at: new Date().toISOString(), order_value: 300_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD',
  }));
  // 100,000 billed two months ago: the billing rate per month follows from it, so months of backlog can be said.
  const invoice = await admin.from('sales_invoices').insert({
    org_id: ORG_ID, project_id: projectId, work_order_id: woId, amount: 100_000, currency: 'USD', tax_treatment: 'exclusive',
    tax_amount: 0, status: 'Unpaid', invoice_date: dayInMonth(2), si_number: `SI-${run}`,
  }).select('id').single();
  if (invoice.error) throw new Error('invoice: ' + invoice.error.message);
  invoiceId = invoice.data.id as string;

  await actor.signIn(page);
  await page.route('**/rest/v1/org_features*', async (route) => {
    const response = await route.fetch({ maxRetries: 2 });
    if (!response.ok()) { await route.fulfill({ response }); return; }
    const rows = (await response.json()) as Array<{ feature_key?: string; enabled?: boolean }>;
    await route.fulfill({ response, json: [...rows.filter((r) => r.feature_key !== 'revenue'), { feature_key: 'revenue', enabled: true }] });
  });
  // Finance → Work in hand (the case's "Projects → Work in hand").
  await page.goto('/finance');
  await page.getByRole('link', { name: 'Work in hand' }).first().click();
  await expect(page).toHaveURL(/\/finance\/work-in-hand/);
  await expect(page.getByRole('heading', { name: 'Work in hand' })).toBeVisible();

  const row = page.getByTestId(`wih-row-${woId}`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  // Columns: value, billed, left to bill, billing rate per month, months of backlog, months toggle.
  const cell = (i: number) => row.locator('td').nth(i);
  await expect(cell(0)).toContainText(/\$300,000/);    // the work order's value
  await expect(cell(1)).toContainText(/\$100,000/);    // billed
  await expect(cell(2)).toContainText(/\$200,000/);    // value left to bill
  // Months of work it represents: billed 100,000 over the 2 complete months since billing began = 50,000 a month;
  // 200,000 left / 50,000 = 4.0 months (never "No billing rate").
  await expect(row).not.toContainText('No billing rate');
  await expect(cell(3)).toContainText(/\$50,000/);
  await expect(cell(4)).toHaveText('4.0');
  // The months behind the figure can be opened.
  await page.getByTestId(`wih-toggle-${woId}`).click();
  const months = page.getByTestId(`wih-months-${woId}`);
  await expect(months).toBeVisible();
  await expect(months).toContainText('2 months counted');
});
