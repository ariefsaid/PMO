// @e2e-isolation: serial — the monthly equipment plan and purchase types are organisation-wide switches; the spec turns them on only for its run, restores them, and deletes its own plan and orders in finally.
/**
 * JOB-E2 — the Equipment Manager plans two rented units for the month and submits the plan; the Finance Manager
 * approves it (a plan needs a second spender, never its author), and two draft rental orders exist, each linked to
 * its plan line. The Buyer opens both orders from the buying screen. Goal oracle: the plan shows one open order per
 * line and the Buyer can open each of them.
 */
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { buyerTest as test } from '../support/buyerOrdering';
import { ORG_ID, need, ok, runId, serviceClient, sqlAsOwner } from '../support/jobFixtures';
import { roleJobUser } from '../support/roleJobUser';
import { userClient } from '../support/stockFixture';

test.setTimeout(240_000);

test('JOB-E2 a two-line monthly plan becomes two rental orders linked to the plan', async ({ page }) => {
  const svc = serviceClient('JOB-E2');
  const admin = await userClient('admin@acme.test');
  const manager = await roleJobUser(svc, 'equipment_manager', runId('e2-em'));
  const buyer = await roleJobUser(svc, 'buyer', runId('e2-buyer'));
  const finance = await roleJobUser(svc, 'finance_manager', runId('e2-fm'));
  const run = runId('e2');
  const projectId = randomUUID();
  const vendorId = randomUUID();
  const craneA = `${run} crawler crane`;
  const craneB = `${run} mobile crane`;
  let planBefore: { enabled: boolean; approval_step: string; allow_self_approval: boolean } | null = null;
  let typesBefore: { enabled: boolean } | null = null;
  try {
    need('project', await svc.from('projects').insert({ id: projectId, org_id: ORG_ID, name: run, status: 'Ongoing Project', currency: 'IDR' }).select('id').single());
    need('vendor', await svc.from('companies').insert({ id: vendorId, org_id: ORG_ID, name: `${run} rental`, type: 'Vendor' }).select('id').single());

    // The switches an Admin would turn on, remembered for the reset.
    const planSettings = await svc.from('org_equipment_plan_settings').select('enabled, approval_step, allow_self_approval').eq('org_id', ORG_ID).maybeSingle();
    if (planSettings.error) throw planSettings.error;
    planBefore = planSettings.data;
    const typeSettings = await svc.from('org_purchase_type_settings').select('enabled').eq('org_id', ORG_ID).maybeSingle();
    if (typeSettings.error) throw typeSettings.error;
    typesBefore = typeSettings.data;
    ok('purchase types on', await admin.rpc('set_purchase_types_enabled', { p_enabled: true }));
    ok('plan on', await admin.rpc('set_equipment_plan_settings', { p_enabled: true, p_approval_step: 'senior_role', p_allow_self_approval: false }));

    // 1. The Equipment Manager plans two rented units for the month.
    await manager.signIn(page);
    await page.goto('/equipment-plans');
    await page.getByRole('combobox', { name: 'Project' }).click();
    await page.locator('div[role="option"]', { hasText: run }).first().click();
    for (const crane of [craneA, craneB]) {
      await page.getByRole('button', { name: 'Add line' }).click();
      const line = page.getByTestId('plan-line').filter({ has: page.getByRole('textbox', { name: 'What is needed' }) }).last();
      await line.getByRole('textbox', { name: 'What is needed' }).fill(crane);
      await line.getByRole('combobox', { name: 'Vendor' }).click();
      await page.locator('div[role="option"]', { hasText: `${run} rental` }).first().click();
      await line.getByRole('textbox', { name: 'Quantity' }).fill('1');
      await line.getByRole('textbox', { name: 'Rate' }).fill('5000000');
    }
    // 2. She submits it; the plan now waits for a second spender.
    await page.getByRole('button', { name: 'Submit for approval' }).click();
    await expect(page.getByTestId('equipment-plan')).toContainText(/Waiting for approval|Menunggu persetujuan/i, { timeout: 20_000 });

    // 3. The Finance Manager approves it, which converts it into rental orders.
    await finance.signIn(page);
    await page.goto('/equipment-plans');
    await page.getByRole('combobox', { name: 'Project' }).click();
    await page.locator('div[role="option"]', { hasText: run }).first().click();
    await page.getByRole('button', { name: 'Approve and create orders' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Approve and create orders' }).click();
    await expect(page.getByTestId('equipment-plan')).toContainText(/Approved|Disetujui/i, { timeout: 20_000 });

    // 4. Goal: each plan line carries its own order, and the Buyer can open both of them.
    const orderLinks = page.getByTestId('plan-line-order');
    await expect(orderLinks).toHaveCount(2, { timeout: 20_000 });
    const orderIds: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      await expect(orderLinks.nth(i)).toBeVisible();
      const href = await orderLinks.nth(i).getAttribute('href');
      orderIds.push(href?.split('/procurement/')[1] ?? '');
    }
    expect(orderIds.filter(Boolean)).toHaveLength(2);
    const linked = await svc.from('equipment_plan_lines').select('procurement_id').eq('org_id', ORG_ID).in('procurement_id', orderIds);
    if (linked.error) throw linked.error;
    expect(linked.data).toHaveLength(2);

    await buyer.signIn(page);
    // Each order is a rental order for one of the two planned units and names the monthly plan it came from.
    const titles: string[] = [];
    for (const id of orderIds) {
      await page.goto(`/procurement/${id}`);
      await expect(page.getByTestId('rental-panel')).toContainText(/Rental|Sewa/, { timeout: 20_000 });
      await expect(page.getByTestId('rental-panel')).toContainText(/\d+ \w+ – \d+ \w+/); // the rental period
      titles.push((await page.getByRole('heading', { level: 1 }).first().innerText()).trim());
      // TC-PFE-24: "each linked to the plan" from the Buyer's side: the order names the monthly plan it came from.
      await page.getByRole('tab', { name: /^Line items/ }).click();
      await expect(page.getByText(/Monthly plan \d{4}-\d{2}/).first()).toBeVisible();
    }
    expect(titles.some((x) => x.startsWith(craneA))).toBe(true);
    expect(titles.some((x) => x.startsWith(craneB))).toBe(true);
  } finally {
    if (typesBefore !== null || planBefore !== null) {
      // The plan's lines point at its orders, and the guard freezes an approved plan, so the run's rows go as the local owner.
      sqlAsOwner(`delete from equipment_plan_lines where plan_id in (select id from equipment_plans where project_id = '${projectId}'); delete from equipment_plans where project_id = '${projectId}'; delete from purchase_requests where procurement_id in (select id from procurements where project_id = '${projectId}'); delete from procurement_items where procurement_id in (select id from procurements where project_id = '${projectId}'); delete from procurements where project_id = '${projectId}';`);
      await admin.rpc('set_equipment_plan_settings', {
        p_enabled: planBefore?.enabled ?? false,
        p_approval_step: planBefore?.approval_step ?? 'spend_approvers',
        p_allow_self_approval: planBefore?.allow_self_approval ?? false,
      });
      if (!typesBefore?.enabled) {
        await admin.rpc('set_purchase_types_enabled', { p_enabled: false });
        // The starter rows the switch seeded are ours alone once the run's orders are gone.
        const fresh = await svc.from('purchase_types').select('id').eq('org_id', ORG_ID);
        if (!fresh.error && (fresh.data ?? []).length > 0) sqlAsOwner(`delete from purchase_types where org_id = '${ORG_ID}';`);
      }
      ok('vendor cleanup', await svc.from('companies').delete().eq('id', vendorId));
      ok('project cleanup', await svc.from('projects').delete().eq('id', projectId));
    }
    // The approval created the orders for this run's logins: their create-intent and status rows go before the logins do.
    sqlAsOwner(`delete from procurement_create_intents where actor_id in ('${finance.id}','${buyer.id}','${manager.id}'); delete from procurement_status_events where actor_id in ('${finance.id}','${buyer.id}','${manager.id}');`);
    await finance.cleanup();
    await buyer.cleanup();
    await manager.cleanup();
  }
});
