// @e2e-isolation: serial — sets the organisation's material-request approval chain (an org-wide singleton) to one Engineer step and restores the prior chain in finally; its own project, work order, allowance, stock item and delivery location keep the rest isolated.
// JOB-PC24 (material person): a request above the plan carries a reason and goes first to the engineer's step. Plan 100, request 120.
import { test, expect, type Page } from '@playwright/test';
import { makeItem, runSuffix, userClient } from '../support/stockFixture';
import { cleanupAll, need, ok, ORG_ID, projectWithWorkOrders, serviceClient } from '../support/jobFixtures';
import { roleJobUser } from '../support/roleJobUser';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
test.setTimeout(180_000);

async function pick(page: Page, label: RegExp, option: string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option }).click();
}

test("JOB-PC24 a request of 120 against a plan of 100 asks for a reason and waits at the engineer's step", async ({ page }) => {
  const admin = serviceClient('JOB-PC24');
  const sfx = runSuffix();
  let ownProjectId = '';
  let woIds: string[] = [];
  let boqId = '';
  let requestId = '';
  let priorChain: unknown[] | null = null;
  const requester = await roleJobUser(admin, 'material_coordinator', `JOBPC24-${sfx}-req`);
  const engineer = await roleJobUser(admin, 'engineer', `JOBPC24-${sfx}-eng`);

  try {
    const fx = await projectWithWorkOrders(admin, `JOBPC24-${sfx}`, ['Concrete']);
    ownProjectId = fx.projectId; woIds = fx.workOrders.map((w) => w.id);
    const wo = fx.workOrders[0];
    const adminUser = await userClient('admin@acme.test');
    ok('site location', await admin.from('stock_warehouses').insert({ code: `E2E-S${sfx}`, name: `E2E site ${sfx}`, kind: 'site', project_id: ownProjectId, org_id: ORG_ID }));
    const item = await makeItem(adminUser, sfx, 'P');
    boqId = need('line', await admin.from('boq_items').insert({ org_id: ORG_ID, project_id: ownProjectId, item_code: 'CONC', description: 'Concrete', unit: 'm3', quantity: 100, rate: 10 }).select('id').single()).id as string;
    ok('allocation', await admin.from('work_order_lines').insert({ org_id: ORG_ID, work_order_id: wo.id, boq_item_id: boqId, quantity: 100 }));
    ok('allowance', await admin.from('boq_material_allowances').insert({ org_id: ORG_ID, boq_item_id: boqId, item_id: item.id, planned_quantity: 100 }));

    // The Admin sets a single chain step that the engineer job role decides; the prior chain is put back in finally.
    priorChain = need('prior chain', await admin.from('approval_chain_steps').select('position, role, job_role, label, only_over_plan').eq('org_id', ORG_ID).order('position'));
    ok('chain', await adminUser.rpc('mrq_set_chain', { p_steps: [{ job_role: 'engineer', label: 'Engineer check', only_over_plan: false }] }));

    await requester.signIn(page);
    await page.goto('/material-requests/new');
    await pick(page, /^project/i, `JOBPC24-${sfx} project`);
    await pick(page, /^work order/i, `${wo.number} · ${wo.title}`);
    await page.getByLabel(/^item/i).selectOption({ label: `${item.code} · ${item.name}` });
    await page.getByLabel(/^quantity/i).fill('120');
    await expect(page.getByTestId('mrq-plan')).toContainText('Over plan');
    await expect(page.getByTestId('mrq-plan')).toContainText('100');

    // No reason: refused. With a reason: sent, and it waits at the engineer's step.
    await page.getByRole('button', { name: 'Send for approval' }).click();
    await expect(page.getByText(/give a reason/i)).toBeVisible();
    await page.getByLabel(/why do you need more than the plan/i).fill('Extra pour on the east slab');
    await page.getByRole('button', { name: 'Send for approval' }).click();
    await expect(page).toHaveURL(/\/material-requests\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    requestId = page.url().split('/').pop() ?? '';
    await expect(page.getByTestId('mrq-chain')).toContainText('Engineer check');
    await expect(page.getByText('Waiting for approval').first()).toBeVisible();
    await expect(page.getByText(/Over plan: Extra pour on the east slab/)).toBeVisible();
    // The requester never decides their own request.
    await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);

    // The engineer — not the requester — decides first, on the same request.
    await engineer.signIn(page);
    await page.goto(`/material-requests/${requestId}`);
    await expect(page.getByTestId('mrq-chain')).toContainText('Engineer check', { timeout: 20_000 });
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
    await dialog.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(page.getByText('Waiting for approval')).toHaveCount(0, { timeout: 20_000 });

    await requester.signIn(page);
    await page.goto(`/material-requests/${requestId}`);
    await expect(page.getByTestId('mrq-chain')).toContainText('Engineer check');
    await expect(page.getByText('Waiting for approval')).toHaveCount(0, { timeout: 20_000 });
  } finally {
    if (priorChain) {
      ok('restore chain', await admin.from('approval_chain_steps').delete().eq('org_id', ORG_ID));
      if (priorChain.length > 0) {
        ok('restore chain rows', await admin.from('approval_chain_steps').insert(
          priorChain.map((s) => ({ ...(s as Record<string, unknown>), org_id: ORG_ID })) as never));
      }
    }
    if (requestId) await admin.from('material_requests').delete().eq('id', requestId);
    await cleanupAll(admin, [
      ['boq_material_allowances', 'boq_item_id', boqId ? [boqId] : []],
      ['work_order_lines', 'work_order_id', woIds],
      ['boq_items', 'id', boqId ? [boqId] : []],
      ['work_orders', 'id', woIds],
      ['projects', 'id', ownProjectId ? [ownProjectId] : []],
    ]).catch(() => undefined);
    await admin.from('stock_warehouses').delete().eq('code', `E2E-S${sfx}`);
    await engineer.cleanup();
    await requester.cleanup();
  }
});
