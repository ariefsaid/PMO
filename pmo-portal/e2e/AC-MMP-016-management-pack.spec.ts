// @e2e-isolation: self-isolated — creates its own uniquely named project + invoice (+ progress entry) and deletes them; the revenue entitlement is granted by rewriting this page's org_features read, never by mutating the org.
/**
 * AC-MMP-016 — Finance runs the monthly management pack: opens it from the rail, picks this month, sees the
 * project's invoiced figure, records 50% progress, sees recognised and unbilled move, and exports a CSV that
 * labels the currency. Goal oracle: the pack's figures and the exported row, not the presence of controls.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { signIn, requireServiceRoleKey } from './helpers';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const svcKey = requireServiceRoleKey();
test.skip(!svcKey, 'AC-MMP-016: SUPABASE_SERVICE_ROLE_KEY not set (local) — skipping');

test('AC-MMP-016: Finance records progress and exports the monthly management pack', async ({ page }) => {
  const admin = createClient(SUPABASE_URL, svcKey!);
  const now = new Date();
  const year = now.getUTCFullYear();
  const ym = `${year}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const projectId = crypto.randomUUID();
  const invoiceId = crypto.randomUUID();
  const name = `MMP e2e ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const { data: org, error: orgErr } = await admin.from('organizations').select('default_currency').eq('id', ORG_ID).single();
  if (orgErr || !org) throw new Error(`org read failed: ${orgErr?.message}`);
  const { error: pErr } = await admin.from('projects').insert({
    id: projectId, org_id: ORG_ID, name, status: 'Ongoing Project', contract_value: 1_000_000,
    tax_treatment: 'exclusive', tax_amount: 0, start_date: `${year}-01-01`, end_date: `${year}-12-31`,
  });
  if (pErr) throw new Error(`seed project failed: ${pErr.message}`);
  const { error: iErr } = await admin.from('sales_invoices').insert({
    id: invoiceId, org_id: ORG_ID, project_id: projectId, amount: 250_000, tax_treatment: 'exclusive',
    tax_amount: 0, status: 'Unpaid', invoice_date: `${ym}-15`,
  });
  if (iErr) throw new Error(`seed invoice failed: ${iErr.message}`);

  try {
    await page.route('**/rest/v1/org_features*', async (route) => {
      const response = await route.fetch();
      if (!response.ok()) {
        await route.fulfill({ response });
        return;
      }
      const rows = (await response.json()) as Array<{ feature_key?: string; enabled?: boolean }>;
      await route.fulfill({
        response,
        json: [...rows.filter((r) => r.feature_key !== 'revenue'), { feature_key: 'revenue', enabled: true }],
      });
    });
    await signIn(page, 'finance@acme.test');

    await page.getByRole('link', { name: 'Management pack' }).click();
    await expect(page).toHaveURL(/\/reports/);
    await page.getByLabel('As at').fill(ym);

    const row = page.locator('tr', { hasText: name });
    await expect(row.getByTestId('pack-cell-invoicedToDate')).toHaveText(/250[.,]000/);

    await row.getByRole('button', { name: 'Record progress' }).click();
    await page.getByLabel(/Percent complete to date/).fill('50');
    await page.getByRole('button', { name: 'Save progress' }).click();

    await expect(row.getByTestId('pack-cell-recognisedToDate')).toHaveText(/500[.,]000/);
    await expect(row.getByTestId('pack-cell-unbilled')).toHaveText(/250[.,]000/);

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    const download = await downloadPromise;
    const csv = readFileSync(await download.path(), 'utf-8');
    const line = csv.split('\r\n').find((l) => l.startsWith(ym) && l.includes(name));
    expect(line, "the exported pack has this project's as-at month row").toBeDefined();
    expect(line).toContain(`,${org.default_currency},`);
    expect(line).toContain(',500000,');
  } finally {
    await admin.from('project_progress_entries').delete().eq('project_id', projectId);
    await admin.from('sales_invoices').delete().eq('id', invoiceId);
    await admin.from('projects').delete().eq('id', projectId);
  }
});
