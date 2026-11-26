// @e2e-isolation: serial — disconnects the seed organisation's accounting binding for the run (org-wide state other specs must see unchanged) and restores it in afterAll; also creates and deletes its own project, budget, approver, work order, discipline and claim.
/**
 * JOB-FN4 — a Finance Officer files a one-million-rupiah expense claim naming a work order and a discipline; the
 * Finance Manager approves it; the work order's material/expense cost and that discipline's cost each rise by
 * exactly one million. Goal oracle: the work order's own cost section carries the claim under its discipline.
 */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { ORG_ID, need, ok, runId, serviceClient } from '../support/jobFixtures';
import { orgToday } from '../support/jobJourney';
import { roleJobUser } from '../support/roleJobUser';
import { disconnectSeedOrgErp, type NoErpHandle } from './noErpOrg';
import { openWorkOrderArea } from '../support/workOrderArea';

test.setTimeout(180_000);

// An organisation with no accounting system: an approved claim counts at once (with one connected it counts once posted).
let noErp: NoErpHandle | undefined;
test.beforeAll(async () => { noErp = await disconnectSeedOrgErp(); });
test.afterAll(async () => { await noErp?.restore(); });

test('JOB-FN4 an approved one-million site claim raises its work order and discipline cost by one million', async ({ page }) => {
  const svc = serviceClient('JOB-FN4');
  const run = runId('fn4');
  const officer = await roleJobUser(svc, 'finance_officer', runId('fn4-of'));
  const manager = await roleJobUser(svc, 'finance_manager', runId('fn4-mgr'));
  const projectId = randomUUID();
  const workOrderId = randomUUID();
  const disciplineId = randomUUID();
  const versionId = randomUUID();
  const tag = `${run} cable ties`;
  try {
    need('project', await svc.from('projects').insert({ id: projectId, org_id: ORG_ID, name: run, status: 'Ongoing Project', currency: 'IDR' }).select('id').single());
    // Budget lines land only on a Draft version: Draft -> line -> Active.
    need('budget draft', await svc.from('budget_versions').insert({ id: versionId, org_id: ORG_ID, project_id: projectId, name: run, version: 1, status: 'Draft' }).select('id').single());
    need('budget line', await svc.from('budget_line_items').insert({ org_id: ORG_ID, budget_version_id: versionId, category: 'Special expenses', budgeted_amount: 5_000_000 }).select('id').single());
    need('budget active', await svc.from('budget_versions').update({ status: 'Active' }).eq('id', versionId).select('id').single());
    need('work order', await svc.from('work_orders').insert({
      id: workOrderId, org_id: ORG_ID, project_id: projectId, wo_number: `WO-${run.slice(-8)}`, title: `${run} scope`,
      status: 'Issued', issued_at: new Date().toISOString(), order_value: 10_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'IDR',
    }).select('id').single());
    need('discipline', await svc.from('cost_disciplines').insert({ id: disciplineId, org_id: ORG_ID, code: `D${run.slice(-6).toUpperCase()}`, name: `${run} Civil` }).select('id').single());
    need('named approver', await svc.from('spend_approvers').insert({ org_id: ORG_ID, project_id: projectId, profile_id: manager.id }).select('id').single());

    // 1. The Finance Officer files the claim, naming the work order and the discipline.
    await officer.signIn(page);
    await page.goto('/expenses/new');
    await page.getByRole('textbox', { name: 'Title' }).fill(tag);
    await page.getByLabel('Project').selectOption({ label: run });
    await page.getByLabel('Budget category').selectOption('Special expenses');
    await page.getByRole('combobox', { name: 'Work order' }).click();
    await page.locator('div[role="option"]', { hasText: run }).first().click();
    await page.getByRole('combobox', { name: 'Discipline' }).click();
    await page.locator('div[role="option"]', { hasText: `${run} Civil` }).first().click();
    await page.getByLabel(/^Date/).first().fill(orgToday());
    await page.getByLabel(/^Type/).first().selectOption('Travel');
    await page.getByLabel(/^Description/).first().fill('Site run');
    await page.getByRole('textbox', { name: 'Amount' }).first().fill('1000000');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page).toHaveURL(/\/expenses\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    const claimUrl = page.url();
    await page.getByRole('button', { name: 'Submit for approval' }).click();
    await expect(page.getByTestId('expense-status')).toHaveAttribute('data-status', 'Submitted', { timeout: 20_000 });

    // 2. The Finance Manager approves it.
    await manager.signIn(page);
    await page.goto(claimUrl);
    await page.getByRole('button', { name: /^(Approve|Setujui)$/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: /^(Approve|Setujui)$/ }).click();
    await expect(page.getByTestId('expense-status')).toHaveAttribute('data-status', 'Approved', { timeout: 20_000 });

    // 3. Goal: the work order's cost carries the claim, once, at one million, under the named discipline.
    await page.goto(`/work-orders/${workOrderId}`);
    await openWorkOrderArea(page, 'cost');
    const group = page.getByTestId('cost-group-expense_claim');
    await expect(group).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('cost-total-expense_claim')).toContainText(/1[.,]000[.,]000/);
    const discipline = page.getByTestId(`cost-discipline-expense_claim-${disciplineId}`);
    await expect(discipline).toBeVisible();
    await expect(discipline).toContainText(/1[.,]000[.,]000/);
  } finally {
    ok('claims cleanup', await svc.from('expense_claims').delete().eq('project_id', projectId));
    ok('approver cleanup', await svc.from('spend_approvers').delete().eq('project_id', projectId));
    ok('work order cleanup', await svc.from('work_orders').delete().eq('id', workOrderId));
    ok('discipline cleanup', await svc.from('cost_disciplines').delete().eq('id', disciplineId));
    ok('budget cleanup', await svc.from('budget_versions').delete().eq('project_id', projectId));
    ok('project cleanup', await svc.from('projects').delete().eq('id', projectId));
    await manager.cleanup();
    await officer.cleanup();
  }
});
