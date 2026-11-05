// @e2e-isolation: serial - sets the shared org's ERP binding project map for its own project (org-global state); restores it in finally.
/**
 * AC-JEC-015 (#1919) - a journal the accounting system booked to a project can be tied to the PMO purchase it paid.
 *
 * Journey: Finance opens the project's Procurement tab, sees the journal line ("Not in a purchase"), attaches it to the
 * project's purchase from the row, then opens the purchase and finds the line listed there. The cost is counted once:
 * the project's spent figure is the same before and after, and the project's open commitment falls by the line amount.
 *
 * ISOLATION: unique project, purchase, journal rows and voucher per run; the binding config is snapshotted and restored;
 * every row is deleted in finally, even on failure.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../src/lib/supabase/database.types';
import { signIn, requireServiceRoleKey, SEED_PASSWORD } from '../helpers';

test.setTimeout(120_000);

const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const COST_ACCOUNT = 'Subcontractor Costs - PSC'; // mapped to Subcontractors by the seed
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const svcKey = requireServiceRoleKey();
if (!svcKey) throw new Error('AC-JEC-015: SUPABASE_SERVICE_ROLE_KEY is required for this owning journey - it must not silently skip.');
const admin = createClient(SUPABASE_URL, svcKey, { auth: { persistSession: false } });

test('AC-JEC-015: Finance attaches a journal line to a purchase and finds it on the purchase', async ({ page }) => {
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
  const projectId = crypto.randomUUID();
  const procurementId = crypto.randomUUID();
  const erpProject = `JEC-${suffix}`;
  const voucher = `JEC-JV-${suffix}`;
  const purchaseTitle = `JEC purchase ${suffix}`;
  const glName = `jec-gl-${suffix}`;

  const { data: binding, error: bErr } = await admin.from('external_org_bindings').select('config').eq('org_id', ORG_ID).eq('external_tier', 'erpnext').single();
  if (bErr || !binding) throw new Error(`AC-JEC-015: no ERP binding to snapshot: ${bErr?.message}`);
  const priorConfig = binding.config as Record<string, unknown>;
  try {
    const { data: fin } = await admin.from('profiles').select('id').eq('org_id', ORG_ID).eq('email', 'finance@acme.test').single();
    const { data: org } = await admin.from('organizations').select('default_currency').eq('id', ORG_ID).single();
    const currency = org?.default_currency ?? 'IDR';
    const must = (label: string, e: { message: string } | null) => { if (e) throw new Error(`AC-JEC-015 seed ${label} failed: ${e.message}`); };

    must('project', (await admin.from('projects').insert({ id: projectId, org_id: ORG_ID, name: `JEC e2e ${suffix}`, status: 'Ongoing Project' })).error);
    must('binding', (await admin.from('external_org_bindings').update({ config: { ...priorConfig, project_map: { ...(priorConfig.project_map as object ?? {}), [projectId]: erpProject } } })
      .eq('org_id', ORG_ID).eq('external_tier', 'erpnext')).error);
    must('purchase', (await admin.from('procurements').insert({
      id: procurementId, org_id: ORG_ID, title: purchaseTitle, requested_by_id: fin!.id, project_id: projectId, currency, total_value: 5000, status: 'Ordered',
    })).error);
    must('journal', (await admin.from('erp_gl_entry_mirror').insert({
      org_id: ORG_ID, erp_name: glName, company: 'PMO Smoke Co', account: COST_ACCOUNT, project: erpProject, voucher_type: 'Journal Entry',
      voucher_no: voucher, posting_date: '2026-03-01', debit: 1200, credit: 0, is_cancelled: false, remarks: `Vendor e2e ${suffix}`, erp_modified: '2026-03-01 10:00:00',
    })).error);

    // The project's money as Finance reads it (the figures the project screens show), before and after the attach.
    if (!ANON_KEY) throw new Error('AC-JEC-015: VITE_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY) is required');
    const finance = createClient<Database>(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const { error: authErr } = await finance.auth.signInWithPassword({ email: 'finance@acme.test', password: SEED_PASSWORD });
    if (authErr) throw authErr;
    const projectMoney = async () => {
      const spent = await finance.rpc('project_mapped_actuals', { p_project_id: projectId });
      const committed = await finance.rpc('project_committed_spend', { p_project_id: projectId });
      if (spent.error || committed.error) throw new Error(`AC-JEC-015 read money failed: ${spent.error?.message ?? committed.error?.message}`);
      return {
        spent: (spent.data ?? []).reduce((n, r) => n + Number(r.actuals_to_date), 0),
        committed: (committed.data ?? []).filter((r) => r.is_project_currency).reduce((n, r) => n + Number(r.amount), 0),
      };
    };
    const before = await projectMoney();
    expect(before.committed).toBe(5000);

    await signIn(page, 'finance@acme.test');
    await page.goto(`/projects/${projectId}/procurement`);

    const section = page.getByRole('region', { name: 'Journal entries from the accounting system' });
    const row = section.locator('tr', { hasText: voucher });
    await expect(row).toContainText(/1[.,]200/);
    await expect(row).toContainText(`Vendor e2e ${suffix}`);
    await expect(row).toContainText('Not in a purchase');

    await row.getByRole('button', { name: `Attach ${voucher} to a purchase` }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: /Purchase/ }).click();
    await page.getByRole('option', { name: new RegExp(purchaseTitle) }).click();
    await expect(dialog.getByText(/Ready to attach/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Attach', exact: true }).click();

    await expect(row.getByRole('link', { name: purchaseTitle })).toBeVisible();
    await expect(row.getByRole('button', { name: /Attach/ })).toHaveCount(0);

    await row.getByRole('link', { name: purchaseTitle }).click();
    await expect(page).toHaveURL(new RegExp(`/procurement/${procurementId}`));
    await page.goto(`/procurement/${procurementId}/files`);
    const attached = page.getByRole('region', { name: 'Journal entries from the accounting system' });
    await expect(attached.locator('tr', { hasText: voucher })).toContainText(COST_ACCOUNT);

    // Counted once: the project's spent figure is the same, the purchase's open commitment fell by the line amount.
    const after = await projectMoney();
    expect(after.spent).toBe(before.spent);
    expect(after.committed).toBe(before.committed - 1200);
    const { data: held } = await admin.rpc('procurement_ledger_held', { p_procurement_id: procurementId });
    expect(Number(held)).toBe(1200);
  } finally {
    await admin.from('erp_journal_line_links').delete().eq('procurement_id', procurementId);
    await admin.from('erp_gl_entry_mirror').delete().eq('org_id', ORG_ID).eq('erp_name', glName);
    await admin.from('procurements').delete().eq('id', procurementId);
    await admin.from('projects').delete().eq('id', projectId);
    await admin.from('external_org_bindings').update({ config: priorConfig as never }).eq('org_id', ORG_ID).eq('external_tier', 'erpnext');
  }
});
