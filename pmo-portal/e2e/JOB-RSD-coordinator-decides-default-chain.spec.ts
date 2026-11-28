// @e2e-isolation: self-isolated — creates its own disposable material coordinator login, an issued work order and a stock item per run, and deletes all owned rows in finally.
/**
 * JOB-RSD — the material-request chain default (RR-3, FR-RSD-002).
 * No Admin sets an approval chain: the organisation runs on the shipped default (material coordinator, then the
 * control manager, then the construction manager above plan). An engineer raises and submits a request above plan,
 * and the material coordinator opens it and decides the chain's first step.
 */
import { test, expect } from '@playwright/test';
import { inDays } from './support/jobJourney';
import { ORG_ID, ok, serviceClient } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';
import { makeItem, runSuffix, SEED_PROJECT_ID, userClient } from './support/stockFixture';

test.setTimeout(180_000);

test('JOB-RSD the material coordinator decides the default chain on a submitted request', async ({ page }) => {
  const svc = serviceClient('JOB-RSD');
  const sfx = runSuffix();
  const admin = await userClient('admin@acme.test');
  const engineer = await userClient('engineer@acme.test');
  const coordinator = await roleJobUser(svc, 'material_coordinator', runId('rsd-mc'));
  let itemId = '';
  let unitId = '';
  let workOrderId = '';
  let requestId = '';
  try {
    // The organisation's chain stays at its shipped default for the whole journey (no mrq_set_chain call here).
    const chain = await admin.from('approval_chain_steps').select('position, job_role, label').eq('org_id', ORG_ID).order('position');
    if (chain.error) throw new Error('chain read: ' + chain.error.message);
    const first = (chain.data ?? [])[0];
    if (!first || first.job_role !== 'material_coordinator') {
      throw new Error('precondition: the first chain step is not the default material_coordinator step');
    }

    const item = await makeItem(admin, sfx, 'RD');
    itemId = item.id;
    const itemRow = await svc.from('stock_items').select('unit_id').eq('id', itemId).single();
    unitId = (itemRow.data?.unit_id as string | undefined) ?? '';
    const draft = await admin.from('work_orders').insert({ org_id: ORG_ID, project_id: SEED_PROJECT_ID, title: `E2E RSD ${sfx}`, order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0 }).select('id').single();
    if (draft.error) throw new Error('work order draft: ' + draft.error.message);
    workOrderId = draft.data.id;
    let issue = await admin.rpc('transition_work_order', { p_id: workOrderId, p_to: 'Issued' });
    if (issue.error && /acknowledg/i.test(issue.error.message)) {
      issue = await admin.rpc('transition_work_order', { p_id: workOrderId, p_to: 'Issued', p_over_commit_ack: true });
    }
    if (issue.error) throw new Error('work order issue: ' + issue.error.message);

    const saved = await engineer.rpc('mrq_save_draft', {
      p_request_id: null,
      p_header: { work_order_id: workOrderId, needed_by: inDays(5) },
      p_lines: [{ item_id: itemId, quantity: 7, over_plan_reason: 'Extra pour' }],
    });
    if (saved.error) throw new Error('draft: ' + saved.error.message);
    requestId = saved.data as string;
    const sent = await engineer.rpc('mrq_submit', { p_request_id: requestId });
    if (sent.error) throw new Error('submit: ' + sent.error.message);
    const number = (await engineer.from('material_requests').select('number').eq('id', requestId).single()).data?.number as string;

    // 1. Goal: the material coordinator — the default chain's first step, no Admin setup — opens and decides it.
    await coordinator.signIn(page);
    await page.goto(`/material-requests/${requestId}`);
    await expect(page.getByTestId('mrq-chain')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('mrq-chain')).toContainText('Material coordinator check');
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
    await dialog.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    // 2. The step reads back decided by the coordinator, and the next step (the control manager's) opens.
    const step = await svc.from('material_request_steps')
      .select('status, decided_by').eq('request_id', requestId).eq('position', 1).single();
    if (step.error) throw new Error('step read: ' + step.error.message);
    expect(step.data.status).toBe('approved');
    expect(step.data.decided_by).toBe(coordinator.id);
    await expect(page.getByTestId('mrq-chain')).toContainText('Plan and quantity check', { timeout: 15_000 });
    await page.goto('/material-requests');
    await expect(page.getByText(number).first()).toBeVisible({ timeout: 15_000 });
  } finally {
    if (requestId) {
      ok('request events cleanup', await svc.from('material_request_events').delete().eq('request_id', requestId));
      ok('request steps cleanup', await svc.from('material_request_steps').delete().eq('request_id', requestId));
      ok('request lines cleanup', await svc.from('material_request_lines').delete().eq('request_id', requestId));
      ok('request cleanup', await svc.from('material_requests').delete().eq('id', requestId));
    }
    if (workOrderId) ok('work order cleanup', await svc.from('work_orders').delete().eq('id', workOrderId));
    if (itemId) ok('item cleanup', await svc.from('stock_items').delete().eq('id', itemId));
    if (unitId) ok('unit cleanup', await svc.from('stock_units').delete().eq('id', unitId));
    await coordinator.cleanup();
  }
});
