// @e2e-isolation: serial — connects a disposable org's ERP binding; uses a disposable empty ERPNext company.
/**
 * AC-ECA-050 — S-C: a live PMO org connects to a brand-new, empty ERPNext company.
 *
 * Given an Admin whose org already holds history (3 vendors, 2 projects, a purchase ordered BEFORE the connection, a
 * purchase awaiting approval, 4 distinct line items) and an empty ERPNext company,
 * When the Admin opens Integrations > Match records, reads the census, accepts all, waits for the sends to finish, and then
 * approves and orders one NEW purchase on a sent vendor and project using a sent item,
 * Then the ERP holds a Purchase Order for that purchase naming the sent supplier, project and item; the purchase ordered
 * before the connection says "Recorded before the ERP connection, not sent" and has no ERP Purchase Receipt; and PMO created
 * no ERP Account.
 *
 * Real boundaries only (served functions, real Postgres, real bench). Gated on the DEPENDENCY, never on process.env.CI.
 * Run: scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- scripts/e2e-local.sh --project=serial --workers=1 e2e/serial/AC-ECA-050
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import {
  AUTH_URL, SERVICE_KEY, benchPartyCount, FUNCTIONS_URL, READY, activateBinding, benchCount, benchDoc, benchList,
  createBenchCompany, createOrg, dropOrg, loginAs, openMatchRecords, untilWithSweep,
} from './_ecaHelpers';
import { runFullSweep } from './_sweepHelpers';

if (FUNCTIONS_URL && !READY) throw new Error('AC-ECA-050: the served lane is up but its disposable ERP fixture env is incomplete: never a silent skip.');
test.skip(!READY, 'AC-ECA-050 requires the served lane and the prepared ERPNext bed.');
test.setTimeout(420_000);

test('AC-ECA-050 an Admin connects a live PMO org to an empty ERP: masters are sent, a new purchase reaches the ERP, nothing before the connection is sent', async ({ page }) => {
  const admin = createClient(AUTH_URL, SERVICE_KEY);
  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const org = await createOrg(admin, suffix);
  let company: string | undefined;
  try {
    company = await createBenchCompany(suffix);
    const partiesBefore = await benchPartyCount(); // the bench is shared: its suppliers/customers are not per Company
    const accountsBefore = await benchCount('Account', [['company', '=', company]]);

    // -- Given: PMO history ------------------------------------------------------------------------------------------
    const v = [1, 2, 3].map((n) => ({ id: crypto.randomUUID(), name: `ECA050 Vendor ${n} ${suffix}` }));
    const p = [1, 2].map((n) => ({ id: crypto.randomUUID(), name: `ECA050 Project ${n} ${suffix}` }));
    const item = [1, 2, 3, 4].map((n) => `ECA050 Item ${n} ${suffix}`);
    const must = async (q: PromiseLike<{ error: { message: string } | null }>, what: string) => {
      const { error } = await q; if (error) throw new Error(`seed ${what} failed: ${error.message}`);
    };
    await must(admin.from('companies').insert(v.map((x) => ({ id: x.id, org_id: org.orgId, name: x.name, type: 'Vendor' }))), 'companies');
    await must(admin.from('projects').insert(p.map((x) => ({ id: x.id, org_id: org.orgId, name: x.name, status: 'Ongoing Project' }))), 'projects');
    const caseA = crypto.randomUUID(); // ordered before the connection
    const caseB = crypto.randomUUID(); // the NEW purchase
    await must(admin.from('procurements').insert([
      { id: caseA, org_id: org.orgId, title: `ECA050 pre-connect ${suffix}`, vendor_id: v[0].id, project_id: p[0].id, status: 'Ordered', requested_by_id: org.pmId },
      { id: caseB, org_id: org.orgId, title: `ECA050 new ${suffix}`, vendor_id: v[1].id, project_id: p[1].id, status: 'Requested', requested_by_id: org.pmId },
    ]), 'procurements');
    await must(admin.from('procurement_items').insert([
      ...[item[0], item[1], item[2]].map((name) => ({ org_id: org.orgId, procurement_id: caseA, name, quantity: 1, rate: 100000 })),
      ...[item[0], item[3]].map((name) => ({ org_id: org.orgId, procurement_id: caseB, name, quantity: 2, rate: 50000 })),
    ]), 'procurement_items');
    await must(admin.from('purchase_orders').insert({ org_id: org.orgId, procurement_id: caseA, po_number: `PO-PRE-${suffix}`, status: 'Issued' }), 'purchase_orders');

    // The connection happens AFTER that purchase order existed (the cut-over instant is the later of activation and employ time).
    await new Promise((r) => setTimeout(r, 2000));
    await activateBinding(admin, org.orgId, company, ['procurement']);

    // -- When: census -> accept all -> sends finish -------------------------------------------------------------------
    await loginAs(page, org.adminEmail);
    await openMatchRecords(page, org);
    const review = page.getByTestId('connect-proposal-review');
    const partyCard = review.getByTestId('connect-kind-party');
    await untilWithSweep(org.orgId, async () => {
      await expect(partyCard).toContainText(`3 in PMO, ${partiesBefore} in the connected system: 0 are the same, 3 will be sent`, { timeout: 3_000 });
    }, 120_000);

    await review.getByRole('button', { name: 'Accept all' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Accept all' }).click();
    // The sweep sends the masters; then the Admin re-reads both sides (the census is a snapshot) and sees the ERP side hold them. The bed's other parties are brought in too, so the PMO-side count is bed-dependent; links are asserted on the records below.
    await untilWithSweep(org.orgId, async () => {
      expect(await benchPartyCount(), 'the sends reached the ERP').toBe(partiesBefore + 3);
    }, 90_000);
    await review.getByRole('button', { name: 'Check again' }).click();
    await untilWithSweep(org.orgId, async () => {
      await expect(partyCard).toContainText(`${partiesBefore + 3} in the connected system`, { timeout: 3_000 });
    }, 90_000);

    // -- When: one NEW purchase is approved and ordered on a sent vendor/project/item ----------------------------------
    await loginAs(page, org.adminEmail);
    await page.goto(`/procurement/${caseB}`);
    await page.getByRole('button', { name: 'Approve' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Approved', { timeout: 30_000 });
    // An ERP-owned purchase places its order through the Purchase Order capture, which sends it to the ERP.
    await page.getByRole('button', { name: 'Record order' }).click();
    await page.getByTestId('purchase_order-ref-input').fill(`PO-NEW-${suffix}`);
    await page.getByTestId('purchase_order-amount-input').fill('5000000');
    await page.getByTestId('purchase_order-save-btn').click();

    // -- Then: the ERP holds the Purchase Order ------------------------------------------------------------------------
    let poName = '';
    await untilWithSweep(org.orgId, async () => {
      const pos = await benchList('Purchase Order', [['company', '=', company], ['docstatus', '!=', 2]], ['name']);
      expect(pos, 'exactly one ERP Purchase Order (the new purchase), none for the pre-connect one').toHaveLength(1);
      poName = String(pos[0].name);
    }, 90_000).catch(async (err) => {
      const { data: rows } = await admin.from('external_command_outbox').select('domain,state,operation,last_error,attempt_count').eq('org_id', org.orgId).not('domain', 'in', '(companies,items)');
      const { data: own } = await admin.from('external_domain_ownership').select('domain').eq('org_id', org.orgId);
      const { data: pos } = await admin.from('purchase_orders').select('po_number,status').eq('org_id', org.orgId);
      const { data: pr } = await admin.from('procurements').select('title,status').eq('org_id', org.orgId);
      throw new Error(`${(err as Error).message}; own: ${JSON.stringify(own)} pos: ${JSON.stringify(pos)} pr: ${JSON.stringify(pr)}; outbox: ${JSON.stringify(rows).slice(0, 3000)}`, { cause: err });
    });
    // The order is sent to the ERP; the purchase turns Ordered once the sweep delivers it.
    await untilWithSweep(org.orgId, async () => {
      await page.reload();
      await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Ordered', { timeout: 5_000 });
    }, 90_000);
    const po = await benchDoc('Purchase Order', poName);
    expect(po.supplier_name ?? po.supplier).toBe(v[1].name);
    const erpProject = String(po.project ?? (po.items as Array<Json>)[0].project);
    expect((await benchDoc('Project', erpProject)).project_name).toBe(p[1].name);
    const lines = (po.items as Array<Json>).map((l) => String(l.item_name));
    expect(lines).toEqual(expect.arrayContaining([item[0], item[3]]));

    // -- Then: the purchase ordered before the connection stays in PMO ----------------------------------------------------
    await page.goto(`/procurement/${caseA}`);
    await page.getByRole('button', { name: 'Record receipt' }).click();
    await page.getByTestId('gr-status-select').selectOption('Complete');
    await page.getByTestId('btn-save-gr').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save GR' }).click();
    await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Received', { timeout: 30_000 });
    await expect(page.getByTestId('ledger-pre-cutover')).toHaveText('Recorded before the ERP connection, not sent');
    await runFullSweep(FUNCTIONS_URL, org.orgId); // a full tick had its chance to push it
    expect(await benchCount('Purchase Receipt', [['company', '=', company]]), 'no ERP Purchase Receipt for the pre-connect purchase').toBe(0);

    // -- Then: PMO never creates accounts ---------------------------------------------------------------------------------
    expect(await benchCount('Account', [['company', '=', company]])).toBe(accountsBefore);
  } finally {
    await dropOrg(admin, org);
  }
});

type Json = Record<string, unknown>;
