// @e2e-isolation: serial — temporarily scopes the organisation-wide candidate work-order checklist template to two required checks and restores prior active items in finally.
// JOB-PC12 (project control): assess a candidate work order before accepting or rejecting it. An engineer opens two candidates
// and passes the required checks on the first; the project manager accepts the first into a draft work order and rejects the second with a reason.
import { test, expect } from '@playwright/test';
import { cleanupAll, need, ok, ORG_ID, runId, serviceClient } from '../support/jobFixtures';
import { roleJobUser } from '../support/roleJobUser';

test.setTimeout(120_000);

test('JOB-PC12 engineer assesses candidate work orders, and the project manager accepts one into a draft work order and rejects another with a reason', async ({ page }) => {
  const svc = serviceClient('JOB-PC12');
  const run = runId('JOBPC12');
  const engineer = await roleJobUser(svc, 'engineer', `${run}-eng`);
  const pm = await roleJobUser(svc, 'project_manager', `${run}-pm`);

  let projectId = '';
  let priorTemplateIds: string[] = [];
  let templateIds: string[] = [];

  try {
    const prior = need('existing checklist', await svc.from('work_order_checklist_items')
      .select('id').eq('org_id', ORG_ID).is('archived_at', null));
    priorTemplateIds = prior.map((r: { id: string }) => r.id);
    if (priorTemplateIds.length > 0) {
      ok('pause prior checklist', await svc.from('work_order_checklist_items')
        .update({ archived_at: new Date().toISOString() }).in('id', priorTemplateIds));
    }

    const items = need('template', await svc.from('work_order_checklist_items').insert([
      { org_id: ORG_ID, label: `${run} site readiness check`, position: 1, required: true },
      { org_id: ORG_ID, label: `${run} permit readiness check`, position: 2, required: true },
    ]).select('id'));
    templateIds = items.map((i: { id: string }) => i.id);

    projectId = need('project', await svc.from('projects').insert({
      org_id: ORG_ID,
      name: `${run} project`,
      status: 'Ongoing Project',
      currency: 'USD',
      project_manager_id: pm.id,
    }).select('id').single()).id as string;

    // 1. Engineer opens two candidate work orders and completes the required checks on the first.
    await engineer.signIn(page);
    await page.goto(`/projects/${projectId}/orders`);

    await page.getByRole('button', { name: 'New candidate' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Title').fill(`${run} accepted scope`);
    await dialog.getByRole('button', { name: 'Open candidate' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 });

    const acceptedCard = page.getByRole('listitem').filter({ hasText: `${run} accepted scope` });
    await expect(acceptedCard.getByText('0 of 2 required checks ready')).toBeVisible({ timeout: 20_000 });
    // Engineer assesses checks but cannot decide Accept or Reject.
    await expect(acceptedCard.getByRole('button', { name: 'Accept' })).toHaveCount(0);
    await expect(acceptedCard.getByRole('button', { name: 'Reject' })).toHaveCount(0);

    const results = acceptedCard.getByRole('combobox', { name: 'Result' });
    await results.nth(0).selectOption('passed');
    await expect(acceptedCard.getByText('1 of 2 required checks ready')).toBeVisible({ timeout: 20_000 });
    await results.nth(1).selectOption('passed');
    await expect(acceptedCard.getByText('2 of 2 required checks ready')).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'New candidate' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Title').fill(`${run} deferred scope`);
    await dialog.getByRole('button', { name: 'Open candidate' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByRole('listitem').filter({ hasText: `${run} deferred scope` })).toBeVisible({ timeout: 20_000 });

    // 2. Project manager accepts the assessed candidate and reaches its new Draft work order.
    await pm.signIn(page);
    await page.goto(`/projects/${projectId}/orders`);

    const pmAcceptCard = page.getByRole('listitem').filter({ hasText: `${run} accepted scope` });
    await expect(pmAcceptCard.getByText('2 of 2 required checks ready')).toBeVisible({ timeout: 20_000 });
    await pmAcceptCard.getByRole('button', { name: 'Accept' }).click();
    let reason = page.getByRole('alertdialog').or(page.getByRole('dialog'));
    await reason.getByRole('textbox').fill('All readiness checks verified');
    await reason.getByRole('button', { name: 'Accept' }).click();

    await expect(pmAcceptCard.getByText('Accepted because')).toBeVisible({ timeout: 20_000 });
    await expect(pmAcceptCard.getByText('All readiness checks verified')).toBeVisible();
    await pmAcceptCard.getByRole('link', { name: 'Open the draft work order' }).click();
    await expect(page).toHaveURL(/\/work-orders\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await expect(page.getByText(`${run} accepted scope`).first()).toBeVisible({ timeout: 20_000 });

    // 3. Project manager rejects the second candidate with a reason and confirms it persists after reload.
    await page.goto(`/projects/${projectId}/orders`);
    const pmRejectCard = page.getByRole('listitem').filter({ hasText: `${run} deferred scope` });
    await expect(pmRejectCard).toBeVisible({ timeout: 20_000 });
    await pmRejectCard.getByRole('button', { name: 'Reject' }).click();
    reason = page.getByRole('alertdialog').or(page.getByRole('dialog'));
    await reason.getByRole('textbox').fill('Deferred to next shutdown window');
    await reason.getByRole('button', { name: 'Reject' }).click();

    await expect(pmRejectCard.getByText('Rejected because')).toBeVisible({ timeout: 20_000 });
    await expect(pmRejectCard.getByText('Deferred to next shutdown window')).toBeVisible();

    await page.reload();
    const reloadedReject = page.getByRole('listitem').filter({ hasText: `${run} deferred scope` });
    await expect(reloadedReject.getByText('Rejected because')).toBeVisible({ timeout: 20_000 });
    await expect(reloadedReject.getByText('Deferred to next shutdown window')).toBeVisible();
  } finally {
    const { data } = projectId
      ? await svc.from('work_order_candidates').select('id, work_order_id').eq('project_id', projectId)
      : { data: [] as { id: string; work_order_id: string | null }[] };
    const candidateIds = (data ?? []).map((c) => c.id);
    const workOrderIds = (data ?? []).map((c) => c.work_order_id).filter((x): x is string => Boolean(x));
    await cleanupAll(svc, [
      ['work_order_candidates', 'id', candidateIds],
      ['work_orders', 'id', workOrderIds],
      ['work_order_checklist_items', 'id', templateIds],
      ['projects', 'id', projectId ? [projectId] : []],
    ]);
    if (priorTemplateIds.length > 0) {
      ok('restore prior checklist', await svc.from('work_order_checklist_items')
        .update({ archived_at: null }).in('id', priorTemplateIds));
    }
    await pm.cleanup();
    await engineer.cleanup();
  }
});
