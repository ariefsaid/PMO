// @e2e-isolation: self-isolated — owns its project/invoice/ref and cleans them up.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { signIn, requireServiceRoleKey, waitForFonts } from './helpers';

// AC-PFIN-016 — Finance attributes an adopted ERP invoice's revenue to a project, end to end.
//
// ISOLATION: creates its OWN uniquely-named project + adopted invoice + revenue external ref in
// the seed org (unique-per-run ids/names) and deletes them in reverse-FK order in afterEach, even
// on failure. Touches NO org-global singleton (no ownership toggle, no feature flag, no budget).
//
// Journey (spec §AC-PFIN-016):
//  1. Finance opens Revenue by Project; the Unassigned row opens the unassigned invoices.
//  2. It navigates to the filtered invoice list (/sales-invoices?attribution=unassigned).
//  3. Finance opens the invoice's row menu → "Assign project" → picks the project → Save.
//  4. The attribution persists: DB link + the invoice leaves the unassigned filter + the project
//     Overview finance section reads USD 100.00 invoiced / 75.00 settled / 25.00 outstanding,
//     "No budget" — and the same goal survives a reload.
//  5. No adapter command (ERP push) is issued: PMO attribution only. The spy routes ONLY the
//     adapter-dispatch endpoint — never the assignment RPC or read-model responses.
//
// The local fixture dependency (service-role key) is REQUIRED: this owning journey throws when it
// is missing rather than silently skipping.

test.setTimeout(180_000);

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';

const svcKey = requireServiceRoleKey();
if (!svcKey) {
  throw new Error(
    'AC-PFIN-016: SUPABASE_SERVICE_ROLE_KEY is required for this owning journey ' +
    '(local fixture dependency) — it must not silently skip.',
  );
}
const admin = createClient(SUPABASE_URL, svcKey, { auth: { persistSession: false } });

let PROJECT_ID: string;
let INVOICE_ID: string;
let PROJECT_NAME: string;
let SI_NUMBER: string;

async function seedFixtures(): Promise<void> {
  const { error: projectError } = await admin.from('projects').insert({
    id: PROJECT_ID, org_id: ORG_ID, name: PROJECT_NAME, status: 'Ongoing Project',
    currency: 'USD', contract_value: 100, tax_treatment: 'exclusive', tax_amount: 0,
  });
  if (projectError) throw new Error(`AC-PFIN-016 seed project failed: ${projectError.message}`);
  const { error: invoiceError } = await admin.from('sales_invoices').insert({
    id: INVOICE_ID, org_id: ORG_ID, project_id: null, si_number: SI_NUMBER,
    invoice_date: '2026-01-01', amount: 100, erp_outstanding_amount: 25,
    tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD',
    status: 'Submitted', erp_docstatus: 1, pmo_native: false,
    author_user_id: null,
  });
  if (invoiceError) throw new Error(`AC-PFIN-016 seed invoice failed: ${invoiceError.message}`);
  const { error: refError } = await admin.from('external_refs').insert({
    org_id: ORG_ID, domain: 'revenue', pmo_record_id: INVOICE_ID,
    external_tier: 'erpnext', external_record_id: SI_NUMBER,
  });
  if (refError) throw new Error(`AC-PFIN-016 seed external ref failed: ${refError.message}`);
}

// Reverse-FK cleanup: history rows → external ref → invoice → project. Runs after EVERY test
// (even on failure) so a flaked attempt never poisons a rerun; each retry gets fresh fixture IDs.
async function cleanup(): Promise<void> {
  await admin.from('record_changes').delete().in('entity_id', [INVOICE_ID, PROJECT_ID]);
  await admin.from('external_refs').delete().eq('pmo_record_id', INVOICE_ID);
  await admin.from('sales_invoices').delete().eq('id', INVOICE_ID);
  await admin.from('projects').delete().eq('id', PROJECT_ID);
}

test.beforeEach(async () => {
  // Each test owns independent fixtures: Playwright may run these support and owning oracles in parallel.
  const runId = crypto.randomUUID();
  PROJECT_ID = crypto.randomUUID();
  INVOICE_ID = crypto.randomUUID();
  PROJECT_NAME = `PFIN 1008 Attribution ${runId}`;
  SI_NUMBER = `SI-PFIN1008-${runId}`;
  await seedFixtures();
});

test.afterEach(async () => {
  await cleanup();
});

test('AC-PFIN-016: Finance assigns an adopted invoice to a project — attribution persists, the section reads USD 100/75/25, no budget, and no ERP command is dispatched', async ({ page }) => {
  // Spy ONLY the adapter-dispatch command endpoint: PMO attribution must never push to the ERP.
  // The assignment RPC and read-model responses are deliberately NOT intercepted.
  const adapterCommands: string[] = [];
  await page.route('**/functions/v1/adapter-dispatch*', (route) => {
    adapterCommands.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await signIn(page, 'finance@acme.test');

  // ── Step 1: Revenue by Project → the Unassigned (USD) row opens the unassigned list ────────
  await page.goto('/revenue-by-project');
  // FIN-S6: the Unassigned row is one clickable row (no separate "Assign project" button); currency rides on the amounts.
  const unassignedUsd = page.getByRole('button', { name: 'Open Unassigned (USD)' });
  await expect(unassignedUsd).toBeVisible({ timeout: 20_000 });
  await unassignedUsd.click();

  // ── Step 2: the filtered invoice list ───────────────────────────────────────────────────────
  await expect(page).toHaveURL(/\/sales-invoices\?attribution=unassigned/);
  await expect(page.getByText('Unassigned invoices')).toBeVisible({ timeout: 20_000 });
  const invoiceRow = page.locator('tbody tr', { hasText: SI_NUMBER });
  await expect(invoiceRow).toBeVisible({ timeout: 20_000 });

  // ── Step 3: row menu → Assign project → pick the project → Save ────────────────────────────
  await invoiceRow.getByRole('button', { name: 'Row actions' }).click();
  await page.getByRole('menuitem', { name: 'Assign project' }).click();
  const dialog = page.getByRole('dialog', { name: 'Assign project' });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole('combobox', { name: 'Project' }).click();
  // Combobox options render in a body-level portal, outside the modal dialog subtree.
  await page.getByRole('option', { name: PROJECT_NAME }).click();
  await dialog.getByRole('button', { name: 'Save project' }).click();
  await expect(dialog).not.toBeVisible({ timeout: 15_000 });

  // ── Step 4a: the attribution persisted in the DB ────────────────────────────────────────────
  const { data: linked, error: linkError } = await admin.from('sales_invoices')
    .select('project_id').eq('id', INVOICE_ID).single();
  expect(linkError?.message ?? '').toBe('');
  expect(linked?.project_id).toBe(PROJECT_ID);

  // ── Step 4b: the assigned invoice left the unassigned filter ───────────────────────────────
  await expect(page).toHaveURL(/attribution=unassigned/);
  await expect(page.locator('tbody tr', { hasText: SI_NUMBER })).toHaveCount(0, { timeout: 20_000 });

  // ── Step 4c: the project Overview finance section reads the honest settlement ───────────────
  await page.goto(`/projects/${PROJECT_ID}`);
  const section = page.getByTestId('project-finances');
  await expect(section).toBeVisible({ timeout: 20_000 });
  const usd = page.getByTestId('project-finances-USD');
  await expect(usd).toBeVisible({ timeout: 20_000 });
  await expect(usd).toContainText('$100.00'); // Invoiced
  await expect(usd).toContainText('$75.00');  // Settled (100 − 25 outstanding)
  await expect(usd).toContainText('$25.00');  // Outstanding
  await expect(usd).not.toContainText('$0.00'); // no zero-masking of unknowns
  // PD-C: the budget gap is no longer restated in Project finances (Overview shows no budget card).
  await expect(section).not.toContainText('No budget');

  // ── Step 5: the same goal survives a reload ─────────────────────────────────────────────────
  await page.reload();
  await expect(page.getByTestId('project-finances')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('project-finances-USD')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('project-finances-USD')).toContainText('$100.00');
  await expect(page.getByTestId('project-finances-USD')).toContainText('$75.00');
  await expect(page.getByTestId('project-finances-USD')).toContainText('$25.00');
  await expect(page.getByTestId('project-finances')).not.toContainText('No budget');

  // ── Step 6: no adapter command was ever dispatched ──────────────────────────────────────────
  expect(adapterCommands).toEqual([]);
});

// Support oracle (NOT a business journey — AC-PFIN-015 ownership stays with the RTL suite):
// the section fits a 390px viewport, settlement copy is visible, and the modal is keyboard-operable.
test('AC-PFIN-015 support: project finance mobile layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { error } = await admin.from('sales_invoices').update({ project_id: PROJECT_ID }).eq('id', INVOICE_ID);
  expect(error?.message ?? '').toBe('');

  await signIn(page, 'finance@acme.test');
  await page.goto(`/projects/${PROJECT_ID}`);
  const usd = page.getByTestId('project-finances-USD');
  await expect(usd).toBeVisible({ timeout: 20_000 });
  await waitForFonts(page);
  await expect(usd).toContainText('$25.00');
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  expect(fits).toBe(true);

  await page.goto(`/sales-invoices?q=${SI_NUMBER}`);
  const row = page.locator('tbody tr, [role="row"], li', { hasText: SI_NUMBER }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByRole('button', { name: 'Row actions' }).first().click();
  await page.getByRole('menuitem', { name: /Assign project|Change project/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Tab');
  await expect(dialog.locator(':focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});
