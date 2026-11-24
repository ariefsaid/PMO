// @e2e-isolation: self-isolated — owns its client, project, three work orders and three claims with their steps; deletes them in afterEach.
/**
 * JOB-BQ13 (billing lane): one board of all claims. Three claims sit at three different steps: each card is in its step's column
 * with its age, and the step owner's role finds all three waiting in their needs-you list.
 */
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ORG_ID, need, ok, runId, serviceClient } from './support/jobFixtures';
import { createJobRoleUser } from './support/jobRoleUser';
import { inDays } from './support/jobJourney';
import { cleanupBilling, createBillingFixture, type BillingFixture } from './support/billingFixture';

test.setTimeout(180_000);

let admin: SupabaseClient | undefined;
let fx: BillingFixture | undefined;
let run = '';
let extraWorkOrders: string[] = [];

test.afterEach(async () => {
  if (!admin) return;
  const fail = (step: string, e: { message: string } | null) => { if (e) throw new Error(`JOB-BQ13 cleanup ${step}: ${e.message}`); };
  await cleanupBilling(admin, fx);
  fx = undefined;
  for (const id of extraWorkOrders) fail('work order', (await admin.from('work_orders').delete().eq('id', id)).error);
  extraWorkOrders = [];
});

test('JOB-BQ13 each claim sits in its step column with its age, and the step owner sees them in the needs-you list', async ({ page }) => {
  admin = serviceClient('JOB-BQ13');
  const db = admin;
  run = runId('bq13');
  fx = await createBillingFixture(db, run);
  const billing = await createJobRoleUser(db, ORG_ID, 'billing_officer');
  try {
    const finance = need('finance profile', await db.from('profiles').select('id').eq('org_id', ORG_ID).eq('email', 'finance@acme.test').single());
    // Three work orders on the one project, so the board's cards are told apart by their order number.
    const orderIds = [fx.workOrderId];
    for (const n of [2, 3]) {
      const id = crypto.randomUUID();
      ok(`order ${n}`, await db.from('work_orders').insert({
        id, org_id: ORG_ID, project_id: fx.projectId, title: `${run} order ${n}`, wo_number: `${run}-${n}`, status: 'Issued',
        issued_at: new Date().toISOString(), order_value: 100_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'IDR',
      }));
      orderIds.push(id);
    }
    extraWorkOrders = orderIds.slice(1);
    // Claim n waits at step n; the ages count from when each step started.
    const plan = [
      { order: orderIds[0], ageDays: 2, steps: [{ name: `${run} step one`, done: false }] },
      { order: orderIds[1], ageDays: 4, steps: [{ name: `${run} step one`, done: true }, { name: `${run} step two`, done: false }] },
      { order: orderIds[2], ageDays: 5, steps: [{ name: `${run} step one`, done: true }, { name: `${run} step three`, done: false }] },
    ];
    for (const [i, p] of plan.entries()) {
      const claimId = need(`claim ${i + 1}`, await db.from('progress_claims').insert({
        org_id: ORG_ID, project_id: fx.projectId, work_order_id: p.order, kind: 'progress', currency: 'IDR', gross_amount: 1000, created_by: finance.id,
      }).select('id').single()).id as string;
      const started = inDays(-p.ageDays);
      const rows = p.steps.map((s, j) => ({
        org_id: ORG_ID, claim_id: claimId, project_id: fx.projectId, position: j + 1, name: s.name, client_side: false,
        owner_role: 'Finance', started_on: started,
        ...(s.done ? { completed_on: started, completed_by: finance.id } : {}),
      }));
      ok(`steps ${i + 1}`, await db.from('claim_billing_stages').insert(rows));
    }

    // 1–3. The billing officer opens the board: every card is in its step's column, with its age.
    await billing.signIn(page);
    await page.goto('/finance/billing-board');
    await expect(page).toHaveURL(/\/finance\/billing-board/);
    const expectation: Array<[string, string, string]> = [
      [`${run} step one`, fx.workOrderNumber, `${plan[0].ageDays} days on this step`],
      [`${run} step two`, `${run}-2`, `${plan[1].ageDays} days on this step`],
      [`${run} step three`, `${run}-3`, `${plan[2].ageDays} days on this step`],
    ];
    for (const [column, order, age] of expectation) {
      const col = page.getByTestId('billing-board-column').filter({ has: page.getByRole('heading', { name: column }) });
      await expect(col).toBeVisible({ timeout: 15_000 });
      const card = col.getByTestId('billing-board-card').filter({ hasText: order });
      await expect(card).toContainText(age);
      await expect(card).toContainText('Waiting on Finance');
    }

    // 4. Each step's owner role finds them waiting at home (the org-wide count is other work's, so only the pointer is asserted).
    await page.goto('/');
    const pointer = page.getByRole('link', { name: /billing steps? waiting on your role/i });
    await expect(pointer).toBeVisible({ timeout: 15_000 });
    await pointer.click();
    await expect(page).toHaveURL(new RegExp(`/projects/${fx.projectId}/billing`));
    await expect(page.getByRole('heading', { name: 'Billing claims' })).toBeVisible({ timeout: 15_000 });
  } finally {
    await billing.remove();
  }
});
