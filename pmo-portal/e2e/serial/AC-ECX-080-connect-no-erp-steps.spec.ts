// @e2e-isolation: serial — activates a disposable org's ERP binding; uses a disposable empty ERPNext company.
/**
 * AC-ECX-080 — an operational org connects an empty ERPNext company and completes setup WITHOUT any step inside the ERP.
 *
 * Given an org that already holds history (vendors, a project, purchases, an unpaid invoice, a person who records time)
 * and an empty ERPNext company,
 * When the Admin, working only in PMO (Integrations), sets the company defaults, creates the missing direct-cost
 * account, fills the HR details of the person who records time, accepts all matches, prepares the opening balances
 * and a SECOND Admin approves them, and then a new purchase is ordered and a new timesheet is approved,
 * Then the setup checklist shows "Setup is complete." with no outstanding item, and the ERP holds the new Purchase
 * Order and the new Timesheet.
 *
 * ⚑ INTENDED JOURNEY (plan 2026-11-16-erp-connect-any-time.md, ECX-9). Slices ECX-3..8 are not built when this file is
 * written, so the labels of their steps (defaults select, create account, HR details, opening review) are the plan's
 * intended ones; the first run on the bed after those slices land fixes any wording drift in the STEPS only. The goal
 * oracle (checklist clear, purchase and timesheet in the ERP, no ERP-side write by the test) does not move.
 *
 * ⚑ GATE: on the DEPENDENCY, never process.env.CI. Without the prepared bed (`READY` from _ecaHelpers: served lane,
 * Supabase credentials and ERPNext bench keys) the file does `test.skip(!READY)` at module level, exactly as
 * AC-ECA-050 does, so Playwright does not collect the test (it lists as skipped, not run). A half-configured lane throws.
 *
 * Run: scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- scripts/e2e-local.sh --project=serial --workers=1 e2e/serial/AC-ECX-080
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import {
  AUTH_URL, SERVICE_KEY, SEED_PASSWORD, FUNCTIONS_URL, READY, activateBinding, benchCount, benchList, createBenchCompany,
  createOrg, dropBenchRun, dropOrg, loginAs, openMatchRecords, untilWithSweep,
} from './_ecaHelpers';

if (FUNCTIONS_URL && !READY) throw new Error('AC-ECX-080: the served lane is up but its disposable ERP fixture env is incomplete: never a silent skip.');
test.skip(!READY, 'AC-ECX-080 requires the served lane and the prepared ERPNext bed.');
test.setTimeout(900_000);

test('AC-ECX-080 an operational org connects an empty ERP and finishes setup in PMO alone: checklist clear, next purchase and timesheet reach the ERP', async ({ page }) => {
  const admin = createClient(AUTH_URL, SERVICE_KEY);
  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const org = await createOrg(admin, suffix);
  let company: string | undefined;
  const must = async (q: PromiseLike<{ error: { message: string } | null }>, what: string) => {
    const { error } = await q; if (error) throw new Error(`seed ${what} failed: ${error.message}`);
  };
  try {
    company = await createBenchCompany(suffix);

    // -- Given: PMO history -------------------------------------------------------------------------------------------
    const vendor = { id: crypto.randomUUID(), name: `ECX080 Vendor ${suffix}` };
    const project = { id: crypto.randomUUID(), name: `ECX080 Project ${suffix}` };
    const caseNew = crypto.randomUUID();
    await must(admin.from('companies').insert({ id: vendor.id, org_id: org.orgId, name: vendor.name, type: 'Vendor' }), 'companies');
    await must(admin.from('projects').insert({ id: project.id, org_id: org.orgId, name: project.name, status: 'Ongoing Project' }), 'projects');
    await must(admin.from('procurements').insert({ id: caseNew, org_id: org.orgId, title: `ECX080 new ${suffix}`, vendor_id: vendor.id, project_id: project.id, status: 'Requested', requested_by_id: org.pmId }), 'procurements');
    await must(admin.from('procurement_items').insert({ org_id: org.orgId, procurement_id: caseNew, name: `ECX080 Item ${suffix}`, quantity: 2, rate: 50000 }), 'procurement_items');
    // A second Admin: the opening balances must be approved by someone other than their preparer (AC-ECX-061).
    const second = `ecx080-admin2-${suffix}@acme.test`.toLowerCase();
    const created = await admin.auth.admin.createUser({ email: second, password: SEED_PASSWORD, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(`create second admin failed: ${created.error?.message}`);
    await must(admin.from('profiles').upsert({ id: created.data.user.id, org_id: org.orgId, email: second, full_name: `ECX080 admin2 ${suffix}`, role: 'Admin', status: 'active' }, { onConflict: 'id' }), 'second admin');

    await new Promise((r) => setTimeout(r, 2000)); // the connect instant is after the history
    await activateBinding(admin, org.orgId, company, ['procurement', 'timesheets']);

    // -- When: the Admin works in PMO only ----------------------------------------------------------------------------
    await loginAs(page, org.adminEmail);
    await page.goto('/administration/integrations');
    const checklist = page.getByRole('region', { name: /business setup review/i });
    await expect(checklist).toBeVisible({ timeout: 60_000 });
    await expect(checklist, 'the connection starts with setup still to do').not.toContainText('Setup is complete.');

    // ECX-3: company defaults chosen from mirrored accounts, in PMO.
    await checklist.getByRole('combobox', { name: /payable account/i }).selectOption({ index: 1 });
    await checklist.getByRole('button', { name: /^save$/i }).first().click();
    // ECX-4: the missing direct-cost account is created in PMO.
    await checklist.getByRole('button', { name: /create account/i }).click();
    await page.getByRole('dialog').getByRole('button', { name: /create account/i }).click();
    // ECX-6: HR details of the person who records time, in PMO.
    await checklist.getByRole('link', { name: /add birth date and gender/i }).click();
    await page.getByLabel(/date of birth/i).fill('1990-01-01');
    await page.getByLabel(/gender/i).selectOption({ index: 1 });
    await page.getByLabel(/date of joining/i).fill('2020-01-01');
    await page.getByRole('button', { name: /^save$/i }).click();

    // Match records: accept all, and let the sends finish.
    await openMatchRecords(page, org);
    const review = page.getByTestId('connect-proposal-review');
    await review.getByRole('button', { name: 'Accept all' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Accept all' }).click();
    await untilWithSweep(org.orgId, async () => {
      expect(await benchCount('Supplier', [['supplier_name', 'like', `%${suffix}%`]]), 'the vendor reached the ERP').toBe(1);
    }, 90_000, 'the PMO vendor did not reach the ERP');

    // ECX-7: prepare the opening balances; a second Admin approves.
    await page.goto('/administration/integrations');
    await page.getByRole('button', { name: /prepare opening balances/i }).click();
    await expect(page.getByRole('button', { name: /^approve$/i }), 'the preparer is not offered Approve (AC-ECX-064)').toHaveCount(0);
    await loginAs(page, second);
    await page.goto('/administration/integrations');
    await page.getByRole('button', { name: /review opening balances/i }).click();
    await page.getByRole('button', { name: /^approve$/i }).click();
    await page.getByRole('dialog').getByRole('button', { name: /^approve$/i }).click();
    await untilWithSweep(org.orgId, async () => {
      const entries = await benchList('Journal Entry', [['company', '=', company], ['is_opening', '=', 'Yes'], ['docstatus', '=', 1]], ['name']);
      expect(entries, 'one posted Opening Entry').toHaveLength(1);
    }, 120_000, 'the opening balances did not post');

    // -- Then: the checklist is clear -----------------------------------------------------------------------------------
    await page.goto('/administration/integrations');
    await expect(page.getByRole('region', { name: /business setup review/i })).toContainText('Setup is complete.', { timeout: 60_000 });

    // -- Then: the next purchase reaches the ERP ----------------------------------------------------------------------
    await page.goto(`/procurement/${caseNew}`);
    await page.getByRole('button', { name: 'Approve' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Approved', { timeout: 30_000 });
    await untilWithSweep(org.orgId, async () => {
      expect(await benchCount('Item', [['item_code', 'like', `%${suffix}%`]])).toBe(1);
    }, 120_000, 'the line item did not reach the ERP');
    await page.getByRole('button', { name: 'Record order' }).click();
    await page.getByTestId('purchase_order-ref-input').fill(`PO-ECX080-${suffix}`);
    await page.getByTestId('purchase_order-amount-input').fill('5000000');
    await page.getByTestId('purchase_order-save-btn').click();
    await untilWithSweep(org.orgId, async () => {
      const pos = await benchList('Purchase Order', [['company', '=', company], ['docstatus', '!=', 2]], ['name']);
      expect(pos, 'the new purchase is the connected company\'s one Purchase Order').toHaveLength(1);
    }, 90_000, 'the new purchase did not reach the ERP');

    // -- Then: the next timesheet reaches the ERP ---------------------------------------------------------------------
    const tsId = crypto.randomUUID();
    const monday = new Date(); monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const week = monday.toISOString().slice(0, 10);
    await must(admin.from('timesheets').insert({ id: tsId, org_id: org.orgId, user_id: org.pmId, week_start_date: week, status: 'Submitted', submitted_at: new Date().toISOString() }), 'timesheets');
    await must(admin.from('timesheet_entries').insert({ org_id: org.orgId, timesheet_id: tsId, project_id: project.id, entry_date: week, hours: 8 }), 'timesheet_entries');
    await page.goto('/approvals?scope=timesheets');
    const queue = page.getByRole('region', { name: 'Approvals queue' });
    await queue.getByRole('button').first().click();
    await page.getByRole('region', { name: 'Approval preview' }).getByRole('button', { name: /^approve$/i }).click();
    await page.getByRole('dialog').getByRole('button', { name: /^approve$/i }).click();
    await untilWithSweep(org.orgId, async () => {
      const sheets = await benchList('Timesheet', [['company', '=', company], ['docstatus', '=', 1]], ['name']);
      expect(sheets, 'the approved week is a submitted ERP Timesheet').toHaveLength(1);
    }, 120_000, 'the approved timesheet did not reach the ERP');
  } finally {
    await dropOrg(admin, org);
    await dropBenchRun(suffix, company);
  }
});
