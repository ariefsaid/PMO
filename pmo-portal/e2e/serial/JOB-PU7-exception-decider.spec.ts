// @e2e-isolation: serial — enables the org-wide match setting and restores its previous value.
import { test, expect } from '@playwright/test';
import { moneyJobRole } from '../support/moneyJobRole';
import { serviceClient, need, ok, ORG_ID, sqlAsOwner } from '../support/jobFixtures';
import { createProcurementFixture } from '../procurement-fixture';

test('JOB-PU7 Finance Officer sees who approved the invoice exception and why', async ({ page }) => {
  const db = serviceClient('exception audit');
  const officer = await moneyJobRole('finance_officer', 'Finance');
  const manager = await moneyJobRole('finance_manager', 'Finance');
  ok('manager name', await db.from('profiles').update({ full_name: 'Exception reviewing manager' }).eq('id', manager.id));
  const previous = await db.from('org_three_way_match_settings').select('*').eq('org_id', ORG_ID).maybeSingle();
  ok('match settings', previous);
  const before = previous.data;
  let purchase: Awaited<ReturnType<typeof createProcurementFixture>> | undefined;
  let invoice = '';
  try {
    ok('enable match', await db.from('org_three_way_match_settings').upsert({ org_id: ORG_ID, enabled: true, enabled_at: before?.enabled_at ?? new Date().toISOString(), updated_by: '00000000-0000-0000-0000-0000000000a5', quantity_tolerance_pct: before?.quantity_tolerance_pct ?? 0, amount_tolerance_pct: before?.amount_tolerance_pct ?? 0 }));
    purchase = await createProcurementFixture({ status: 'Received', title: 'Exception audit', withSupplier: true });
    invoice = need('bill', await db.from('procurement_invoices').insert({ procurement_id: purchase.id, status: 'Received', invoice_date: '2026-11-24', amount: 12000, tax_treatment: 'exclusive', tax_amount: 0 }).select('id').single()).id;
    // An Admin prepares a bill with an already-recorded independent decision for the audit job.
    ok('decision', await db.from('bill_match_exceptions').insert({ invoice_id: invoice, org_id: ORG_ID, approved_by: manager.id, approved_at: '2026-11-24T09:00:00Z', reason: 'Agreed delivery shortfall', match: { status: 'held' } }));
    await officer.login(page);
    await page.goto(purchase.url);
    await page.getByRole('tab', { name: /^Files/ }).click();
    const bill = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'VI', exact: true }) });
    await bill.getByRole('button', { name: /Row actions/ }).click();
    await page.getByRole('menuitem', { name: 'Three-way match', exact: true }).click();
    const decision = page.getByTestId('bill-match-exception');
    await expect(decision).toContainText('Exception reviewing manager');
    await expect(decision).toContainText('Agreed delivery shortfall');
    await expect(decision).toContainText(/24 Nov/);
  } finally {
    if (invoice) sqlAsOwner(`delete from public.bill_match_exceptions where invoice_id = '${invoice}'; delete from public.procurement_invoices where id = '${invoice}';`);
    await purchase?.cleanup();
    if (before) ok('restore setting', await db.from('org_three_way_match_settings').upsert(before));
    else ok('remove setting', await db.from('org_three_way_match_settings').delete().eq('org_id', ORG_ID));
    await officer.cleanup(); await manager.cleanup();
  }
});
