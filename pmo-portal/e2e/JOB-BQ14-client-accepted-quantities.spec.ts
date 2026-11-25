// @e2e-isolation: self-isolated — owns its client, project, contract line, work order, two surveys, a confirmed BAST and a claim; deletes them in afterEach.
/**
 * JOB-BQ14 (billing lane): client-accepted quantities. Two surveys on one contract item are recorded, the client's confirmed BAST
 * carries the accepted quantity, the billing tab shows the accepted figure per item, and a new claim for that work order arrives
 * pre-filled from the accepted quantity. The quantity surveyor reads the per-item figures (the case's role); raising the claim is
 * a Finance write, so the pre-fill is taken on the screen by Finance — recorded in docs/private/walk-1124c/lane-hes.md.
 */
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ORG_ID, need, ok, runId, serviceClient, sqlAsOwner } from './support/jobFixtures';
import { createJobRoleUser } from './support/jobRoleUser';
import { cleanupBilling, createBillingFixture, type BillingFixture } from './support/billingFixture';

test.setTimeout(180_000);

let admin: SupabaseClient | undefined;
let fx: BillingFixture | undefined;
let acceptanceId = '';
// The logins go after the claim they raised: the claim references its creator, so deleting a login first fails.
let users: { remove(): Promise<void> }[] = [];

test.afterEach(async () => {
  if (!admin) return;
  if (acceptanceId) {
    // Acceptances are managed by their RPC (a delete is refused for every client): this run's rows go as the database owner.
    sqlAsOwner(`delete from public.work_order_acceptance_lines where acceptance_id = '${acceptanceId}'; delete from public.work_order_acceptances where id = '${acceptanceId}';`);
    acceptanceId = '';
  }
  // Confirmed surveys are frozen for every client (SVY_FROZEN): this run's rows go as the database owner.
  if (fx) sqlAsOwner(`delete from public.survey_records where work_order_id = '${fx.workOrderId}';`);
  await cleanupBilling(admin, fx);
  fx = undefined;
  const gone = users; users = [];
  for (const u of gone) await u.remove();
});

test('JOB-BQ14 measured and accepted quantities show per item and a claim is pre-filled from the accepted one', async ({ page }) => {
  const db = serviceClient('JOB-BQ14');
  admin = db;
  const run = runId('bq14');
  fx = await createBillingFixture(db, run, { workOrderValue: 1_000_000 }); // the order must be worth the 12 km claimed (600,000)
  const qs = await createJobRoleUser(db, ORG_ID, 'quantity_surveyor');
  const financeRole = await createJobRoleUser(db, ORG_ID, 'finance_officer');
  users = [qs, financeRole];
  try {
    const finance = need('finance profile', await db.from('profiles').select('id').eq('org_id', ORG_ID).eq('email', 'finance@acme.test').single());
    // Two surveys certified on the item (8 + 4 m), and the client's confirmed BAST accepting 12 m.
    for (const [i, surveyed] of [8, 4].entries()) {
      ok(`survey ${i + 1}`, await db.from('survey_records').insert({
        org_id: ORG_ID, project_id: fx.projectId, work_order_id: fx.workOrderId, boq_item_id: fx.boqId,
        survey_date: new Date(Date.now() - (i + 1) * 86_400_000).toISOString().slice(0, 10),
        surveyed_quantity: surveyed, quality_ready_quantity: surveyed, status: 'confirmed',
        recorded_by: finance.id, confirmed_by: finance.id, confirmed_at: new Date().toISOString(), confirm_basis: 'standard',
      }));
    }
    acceptanceId = need('acceptance', await db.from('work_order_acceptances').insert({
      org_id: ORG_ID, project_id: fx.projectId, work_order_id: fx.workOrderId, acceptance_date: new Date().toISOString().slice(0, 10),
      is_final: false, status: 'Confirmed', prepared_by: finance.id, confirmed_by: finance.id, confirmed_at: new Date().toISOString(), confirm_basis: 'standard',
    }).select('id').single()).id as string;
    ok('acceptance line', await db.from('work_order_acceptance_lines').insert({ acceptance_id: acceptanceId, boq_item_id: fx.boqId, quantity: 12 }));

    // 2. The quantity surveyor reads the item's measured and accepted quantities on the billing tab.
    await qs.signIn(page);
    await page.goto(`/projects/${fx.projectId}/contract`);
    // The order's contract-quantities table carries the item's accepted (confirmed BAST) quantity in its Delivered column (the only figure with the unit beside it).
    const deliveredOf = (item: string) => page.getByRole('table', { name: /^Contract quantities for/ }).getByRole('row').filter({ hasText: item });
    await expect(deliveredOf('Route survey')).toContainText(/12 km/, { timeout: 15_000 });

    // 3–4. A new claim for the work order arrives pre-filled from the accepted quantity, and records it per item.
    await page.context().clearCookies();
    await financeRole.signIn(page);
    await page.goto(`/projects/${fx.projectId}/contract`);
    await page.getByRole('button', { name: /new claim/i }).click();
    const form = page.getByRole('dialog');
    await form.getByLabel(/^Bills$/i).selectOption(fx.workOrderId);
    // The form offers the surveyed quantities as its starting point (one click); the line then holds the accepted 12.
    await form.getByRole('button', { name: /^Start from the (surveyed|accepted BAST) quantities$/ }).click();
    await expect(form.getByLabel(/SURVEY/)).toHaveValue('12');
    await expect(form.getByTestId(`claim-survey-${fx.boqId}`)).toContainText(/Surveyed 12/);
    await form.getByRole('button', { name: /create claim/i }).click();
    const evidence = page.getByRole('dialog');
    await evidence.getByRole('button', { name: /^(close|cancel|skip)/i }).first().click();
    const reconciliation = page.getByRole('region', { name: /billing reconciliation/i });
    const cells = reconciliation.getByRole('row').filter({ hasText: 'Route survey' }).getByRole('cell');
    await expect(cells.nth(2)).toHaveText('12');
  } finally {
    // (the logins are removed in afterEach, after the rows they made)
  }
});
