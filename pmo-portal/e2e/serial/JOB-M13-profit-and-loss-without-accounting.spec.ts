// @e2e-isolation: serial — disconnects the seed organisation's accounting binding for the run (org-wide state other specs must see unchanged) and restores it in afterAll; owns its Executive login.
// JOB-M13 (acceptance 01-management, TC-M-12): profit and loss without an accounting system. An organisation with nothing
// connected: Finance → Statements points to Reports and asks for no accounting set-up; Reports shows the profit and loss
// figures built from PMO Portal's own records (ruled path: the case is reworded to match the app).
// The revenue entitlement is granted by rewriting this page's org_features read (as JOB-M10 does), never a shared row.
import { test, expect } from '@playwright/test';
import { serviceClient, runId, ORG_ID, ok } from '../support/jobFixtures';
import { roleJobUser } from '../support/roleJobUser';
import { disconnectSeedOrgErp, type NoErpHandle } from './noErpOrg';

test.setTimeout(120_000);

let noErp: NoErpHandle | undefined;
test.beforeAll(async () => { noErp = await disconnectSeedOrgErp(); });
test.afterAll(async () => { await noErp?.restore(); });

test('JOB-M13 the Executive reads the management profit and loss, and nothing asks to set accounting up', async ({ page }) => {
  const svc = serviceClient('JOB-M13');
  const run = runId('JOBM13');
  const actor = await roleJobUser(svc, 'executive', run);
  const contract = 200_000; const billed = 80_000;
  let projectId = ''; let invoiceId = '';
  try {
    const project = await svc.from('projects').insert({
      org_id: ORG_ID, name: `${run} own records`, status: 'Ongoing Project', currency: 'USD', contract_value: contract,
      tax_treatment: 'exclusive', tax_amount: 0,
    }).select('id').single();
    if (project.error) throw new Error('project: ' + project.error.message);
    projectId = project.data.id as string;
    const invoice = await svc.from('sales_invoices').insert({
      org_id: ORG_ID, project_id: projectId, amount: billed, currency: 'USD', tax_treatment: 'exclusive',
      tax_amount: 0, status: 'Unpaid', invoice_date: new Date().toISOString().slice(0, 10), si_number: `SI-${run}`,
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
    // Finance → Statements (the hub's Statements tile links elsewhere when a statement read is unavailable, so the
    // journey opens the section itself after the hub).
    await page.goto('/finance');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 30_000 });
    await page.goto('/finance/statements');
    await expect(page.getByRole('heading', { name: /Management profit and loss/i })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/come from an accounting system when one is connected/i)).toBeVisible();
    // Nothing asks the Executive to set accounting up.
    await expect(page.getByRole('button', { name: /Set up accounting/i })).toHaveCount(0);
    await expect(page.getByText(/No statements yet/i)).toHaveCount(0);

    // Statements points to Reports; Reports shows the figures from PMO Portal's own records.
    await page.getByRole('button', { name: /Open reports/i }).click();
    await expect(page).toHaveURL(/\/finance\/reports/);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(page.getByTestId('management-pack-table-card')).toBeVisible({ timeout: 30_000 });
    const row = page.getByRole('row').filter({ hasText: `${run} own records` }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    const amount = (n: number) => new RegExp(n.toLocaleString('en-US').replace(/,/g, '[.,\\s]?')); // any group separator
    await expect(row).toContainText(amount(contract));          // contract value
    await expect(row).toContainText(amount(billed));            // invoiced
    await expect(row).toContainText(amount(contract - billed)); // left to bill
  } finally {
    if (invoiceId) ok('invoice cleanup', await svc.from('sales_invoices').delete().eq('id', invoiceId));
    if (projectId) {
      await svc.from('record_changes').delete().eq('entity_id', projectId);
      ok('project cleanup', await svc.from('projects').delete().eq('id', projectId));
    }
    await actor.cleanup();
  }
});
