// @e2e-isolation: serial — adds an IDR project to the shared seed org (the org's portfolio goes multi-currency, so executive totals read as unknown), and a confirmed BAST is immutable by design, so the closed fixture is left behind and the project is archived instead. Org-wide aggregate state: run in the serial lane, apart from the parallel dashboard readers.
/**
 * AC-CQ-020 (progress-billing.spec.md §8.7) — contract quantities, end to end through the UI.
 *
 * Given an Issued WO on a generic contract (1,900 km at 50,000, order net 50,000,000) and a signed document in
 * the project register, When the PM allocates 1,000 km, prepares a FINAL BAST of 997 km, and a DISTINCT Finance
 * user confirms it, Then the rendered WO is Closed at 49,850,000, the Billing tab shows contract balance 903 km
 * and earned 49,850,000 (assessment recorded at 1,000 km), and still-to-invoice uses the closing value after
 * navigation / reload.
 *
 * Prerequisites (project, client, BoQ line, Issued WO, issued document with a file, the PM's assessment) are
 * seeded by API; the goal steps are performed by real users in the browser: pm@acme.test then finance@acme.test.
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireServiceRoleKey, signIn, SEED_PASSWORD } from '../helpers';
import { requireMatchingLocalSupabaseUrls } from '../../src/lib/testing/localSupabaseUrl';

test.setTimeout(180_000);

// 49,850,000 whichever grouping separator the profile's number locale uses.
const CLOSING = /49[.,]850[.,]000/;

async function openQuantities(page: Page, projectId: string, woNumber: string) {
  await page.goto(`/projects/${projectId}/work-orders`);
  const summary = page.getByText(new RegExp(`Contract lines and BAST — ${woNumber}`));
  await expect(summary).toBeVisible({ timeout: 60_000 });
  await summary.click();
}

test('AC-CQ-020 PM allocates 1,000 and prepares final BAST 997; distinct Finance confirms; WO closes at 49,850,000 with balance 903 and earned 49,850,000', async ({ page }) => {
  const serviceKey = requireServiceRoleKey();
  if (!serviceKey) throw new Error('AC-CQ-020 requires the local fixture service client');
  const url = requireMatchingLocalSupabaseUrls(undefined, undefined);
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
  if (!anonKey) throw new Error('AC-CQ-020 requires VITE_SUPABASE_ANON_KEY (scripts/e2e-local.sh exports it)');
  const admin: SupabaseClient = createClient(url, serviceKey, { auth: { persistSession: false } });

  const suffix = `CQ20-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const woNumber = `WO-${suffix}`;
  const itemCode = `KM-${suffix}`;
  const itemDescription = `Cable route survey ${suffix}`;
  const documentTitle = `Signed BAST ${suffix}`;
  let projectId = '';
  const workOrderId = crypto.randomUUID();
  const documentId = crypto.randomUUID();

  try {
    // --- Prerequisites by API --------------------------------------------------------------------------------
    const pm = await admin.from('profiles').select('id, org_id').eq('email', 'pm@acme.test').single();
    if (pm.error) throw new Error('AC-CQ-020 fixture PM profile: ' + pm.error.message);
    const orgId = pm.data.org_id as string;

    const company = await admin.from('companies').insert({ org_id: orgId, name: `Client ${suffix}`, type: 'Client' }).select('id').single();
    if (company.error) throw new Error('AC-CQ-020 fixture client: ' + company.error.message);
    const companyId = company.data.id as string;

    const project = await admin.from('projects').insert({
      org_id: orgId, name: `Contract quantities ${suffix}`, status: 'Ongoing Project', currency: 'IDR', client_id: companyId,
      project_manager_id: pm.data.id, contract_value: 95_000_000, tax_treatment: 'exclusive', tax_amount: 0, subject_to_vat: false,
      tax_rate: null, tax_base_numerator: 1, tax_base_denominator: 1,
    }).select('id').single();
    if (project.error) throw new Error('AC-CQ-020 fixture project: ' + project.error.message);
    projectId = project.data.id;

    // A generic contract: 1,900 km at 50,000 per km, earned by the unit rate.
    const boq = await admin.from('boq_items').insert({
      org_id: orgId, project_id: projectId, item_code: itemCode, description: itemDescription, unit: 'km', quantity: 1900, rate: 50_000,
      earning_basis: 'unit_rate',
    }).select('id').single();
    if (boq.error) throw new Error('AC-CQ-020 fixture BoQ line: ' + boq.error.message);
    const boqItemId = boq.data.id as string;

    const workOrder = await admin.from('work_orders').insert({
      id: workOrderId, org_id: orgId, project_id: projectId, title: `Route survey order ${suffix}`, client_po_number: `PO-${suffix}`,
      status: 'Issued', wo_number: woNumber, issued_at: new Date().toISOString(), order_value: 50_000_000, tax_treatment: 'exclusive',
      tax_amount: 0, currency: 'IDR',
    });
    if (workOrder.error) throw new Error('AC-CQ-020 fixture work order: ' + workOrder.error.message);

    // The signed BAST in the project register: Issued, with a file.
    const document = await admin.from('project_documents').insert({
      id: documentId, org_id: orgId, project_id: projectId, category: 'Handover', title: documentTitle, status: 'Issued',
      file_path: `${orgId}/${projectId}/${documentId}/signed-bast.pdf`, code: `BAST-${suffix}`,
    });
    if (document.error) throw new Error('AC-CQ-020 fixture document: ' + document.error.message);

    // The PM's progress assessment: 1,000 km done to date (recorded through the app's own RPC, as the PM).
    const pmClient = createClient(url, anonKey, { auth: { persistSession: false } });
    const login = await pmClient.auth.signInWithPassword({ email: 'pm@acme.test', password: SEED_PASSWORD });
    if (login.error) throw new Error('AC-CQ-020 fixture PM sign-in: ' + login.error.message);
    const month = new Date().toISOString().slice(0, 7) + '-01';
    const assessed = await pmClient.rpc('record_progress_assessment', {
      p_project_id: projectId, p_month: month, p_quantities: [{ boq_item_id: boqItemId, quantity_to_date: 1000 }], p_note: null,
    });
    if (assessed.error) throw new Error('AC-CQ-020 fixture assessment: ' + assessed.error.message);

    await page.setViewportSize({ width: 1440, height: 1000 });

    // --- WHEN the PM allocates 1,000 km to the order ----------------------------------------------------------
    await signIn(page, 'pm@acme.test');
    await openQuantities(page, projectId, woNumber);
    await page.getByRole('button', { name: 'Edit lines' }).click();
    const linesDialog = page.getByRole('dialog', { name: new RegExp(`Contract lines: ${woNumber}`) });
    await expect(linesDialog).toBeVisible();
    await linesDialog.getByLabel(new RegExp(`${itemCode} — ${itemDescription}`)).fill('1000');
    await linesDialog.getByRole('button', { name: `Save ${itemCode}` }).click();
    // 1,900 contract − 1,000 ordered: the dialog itself says 900 km are not yet ordered.
    await expect(linesDialog.getByTestId(`lines-balance-${boqItemId}`)).toContainText(/900\s*km/, { timeout: 30_000 });
    await linesDialog.getByRole('button', { name: 'Done' }).click();
    await expect(linesDialog).toBeHidden();
    await expect(page.getByTestId(`wo-lines-${workOrderId}`)).toContainText(/1,?000\s*km/);

    // --- ...and prepares the FINAL BAST of 997 km against the signed document --------------------------------
    await page.getByRole('button', { name: 'Prepare BAST', exact: true }).click();
    const bastDialog = page.getByRole('dialog', { name: new RegExp(`Prepare BAST — ${woNumber}`) });
    await expect(bastDialog).toBeVisible();
    await bastDialog.getByLabel('Signed BAST document').selectOption({ label: `BAST-${suffix} · ${documentTitle} (Issued)` });
    await bastDialog.getByLabel('This is the final BAST').check();
    await bastDialog.getByLabel(new RegExp(`${itemCode} — ${itemDescription} — accepted to date`)).fill('997');
    await bastDialog.getByRole('button', { name: 'Prepare BAST', exact: true }).click();
    await expect(bastDialog).toBeHidden({ timeout: 30_000 });
    const draft = page.locator(`[data-testid^="bast-"]`).filter({ hasText: 'Draft' });
    await expect(draft).toContainText(/Final/);
    await expect(draft).toContainText(/997\s*km/);

    // --- ...and a DIFFERENT user, Finance, confirms ----------------------------------------------------------
    await signIn(page, 'finance@acme.test');
    await openQuantities(page, projectId, woNumber);
    await page.getByRole('button', { name: 'Confirm BAST' }).click();
    const confirmDialog = page.getByRole('alertdialog', { name: 'Confirm the final BAST?' });
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: 'Confirm final BAST' }).click();
    await expect(confirmDialog).toBeHidden({ timeout: 30_000 });

    // --- THEN the rendered WO is Closed at 49,850,000 --------------------------------------------------------
    const closedRow = page.getByTestId(`customer-order-${workOrderId}`);
    await expect(page.getByTestId(`wo-closing-${workOrderId}`)).toContainText(CLOSING, { timeout: 30_000 });
    await expect(closedRow).toContainText('Closed');

    // ...and after a reload it is still Closed at the closing value, and still-to-invoice uses it (not 50,000,000).
    await page.reload();
    await expect(page.getByTestId(`wo-closing-${workOrderId}`)).toContainText(CLOSING, { timeout: 60_000 });
    await expect(page.getByTestId(`customer-order-${workOrderId}`)).toContainText('Closed');
    await expect(page.getByTestId(`wo-still-${workOrderId}`)).toContainText(CLOSING);
    await expect(page.getByTestId(`wo-still-${workOrderId}`)).not.toContainText(/50[.,]000[.,]000/);

    // --- ...and the Billing tab: contract balance 903 km, earned 49,850,000 -----------------------------------
    await page.goto(`/projects/${projectId}/billing`);
    await expect(page.getByTestId(`contract-balance-${boqItemId}`)).toContainText(/903\s*km/, { timeout: 60_000 });
    await expect(page.getByTestId(`contract-accepted-${boqItemId}`)).toContainText(/997\s*km/);
    await page.getByText('Billing summary details').click();
    await expect(page.getByTestId('work-orders-earned')).toContainText(CLOSING);

    // Navigate away and back: the closing value is the server's, not a stale client figure.
    await page.goto(`/projects/${projectId}/work-orders`);
    await expect(page.getByTestId(`wo-still-${workOrderId}`)).toContainText(CLOSING, { timeout: 60_000 });
  } finally {
    // A Confirmed BAST (and the closed order that references it) is immutable by design, so nothing is deleted.
    // Archiving the unique project keeps the leftover out of every live project list.
    if (projectId) await admin.from('projects').update({ archived_at: new Date().toISOString() }).eq('id', projectId);
  }
});
