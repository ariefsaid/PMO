// @e2e-isolation: serial — sets the organisation-wide quantity-change limit to three for the journey (Admin's setting) and restores
// the previous value in finally.
// JOB-PC8 (project control): quantity change requests. The project control manager raises a request for an over-contract line,
// revises its quantity and submits it; the project manager raises the next two; the work order then refuses a fourth.
// The app's "both versions" are the request's own history (raise, edit, submit) beside the contract quantity and the requested one.
import { test, expect } from '@playwright/test';
import { cleanupAll, need, ok, ORG_ID, projectWithWorkOrders, runId, serviceClient, sqlAsOwner } from '../support/jobFixtures';
import { roleJobUser } from '../support/roleJobUser';
import { asUser } from '../qcrFixture';

test.setTimeout(180_000);

test('JOB-PC8 a project control manager raises, revises and submits a quantity change request, and the work order refuses a fourth', async ({ page }) => {
  const svc = serviceClient('JOB-PC8');
  const run = runId('JOBPC8');
  const pcm = await roleJobUser(svc, 'project_control_manager', `${run}-pcm`);
  const pm = await roleJobUser(svc, 'project_manager', `${run}-pm`);

  let projectId = '';
  let woId = '';
  let priorLimit: number | null = null;
  const boqIds: string[] = [];

  try {
    // Admin sets the organisation limit to three requests per work order (FR-QCR-021).
    priorLimit = need('organisation', await svc.from('organizations').select('quantity_change_limit').eq('id', ORG_ID).single()).quantity_change_limit as number | null;
    ok('limit', await svc.from('organizations').update({ quantity_change_limit: 3 }).eq('id', ORG_ID));

    const fx = await projectWithWorkOrders(svc, run, ['Excavation']);
    projectId = fx.projectId;
    woId = fx.workOrders[0].id;
    const wo = fx.workOrders[0];

    // Four allocated contract lines, each over its contract quantity (assessed 120 against 100).
    for (const [i, code] of ['EXC', 'FIL', 'CMP', 'GRD'].entries()) {
      const boqId = need('contract line', await svc.from('boq_items').insert({
        org_id: ORG_ID, project_id: projectId, item_code: `${code}-${run.slice(-4)}`, description: `${run} ${code} work`, unit: 'm3', quantity: 100, rate: 50,
      }).select('id').single()).id as string;
      boqIds.push(boqId);
      ok('allocation', await svc.from('work_order_lines').insert({ org_id: ORG_ID, work_order_id: woId, boq_item_id: boqId, quantity: 100 }));
      expect(i).toBeLessThan(4);
    }
    const entry = need('progress entry', await svc.from('project_progress_entries').insert({ org_id: ORG_ID, project_id: projectId, month: '2026-02-01', pct_complete: 50 }).select('id').single()).id as string;
    ok('assessed quantities', await svc.from('progress_assessment_quantities').insert(
      boqIds.map((boq_item_id) => ({ org_id: ORG_ID, entry_id: entry, boq_item_id, quantity_to_date: 120 })),
    ));

    // 1. The project control manager raises a request, revises its quantity, and submits it.
    await pcm.signIn(page);
    await page.goto(`/work-orders/${woId}`);
    const section = page.getByTestId('wo-quantity-changes');
    await expect(section).toContainText('0 / 3', { timeout: 30_000 });
    await section.getByRole('button', { name: 'Request a quantity change' }).click();
    let dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('qcr-limit-note')).toContainText('0 of 3 requests used');
    const firstLine = dialog.getByTestId('qcr-raise-line').filter({ hasText: `EXC-${run.slice(-4)}` });
    await firstLine.getByLabel(/^Requested total quantity/).fill('120');
    await firstLine.getByLabel('Reason').fill('Rock found below the design level');
    await dialog.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/quantity-changes\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    const requestUrl = page.url();
    await expect(page.getByTestId('qcr-status')).toHaveAttribute('data-status', 'draft');

    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const line = page.getByTestId('qcr-line').first();
    await line.getByLabel(/^Requested total quantity/).fill('130');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByTestId('qcr-line').first()).toContainText('Requested 130', { timeout: 20_000 });
    await page.getByRole('button', { name: 'Submit for approval' }).click();
    await expect(page.getByTestId('qcr-status')).toHaveAttribute('data-status', 'pending_approval', { timeout: 20_000 });

    // Both versions show: the contract quantity beside the raised and the revised figure, and the history of raise, edit, submit.
    await expect(page.getByTestId('qcr-line').first()).toContainText('Contract quantity 100');
    await expect(page.getByTestId('qcr-line').first()).toContainText('Requested 130');
    const history = page.getByRole('region', { name: 'History' });
    await expect(history).toContainText('Raised', { timeout: 20_000 });
    await expect(history).toContainText('Edited', { timeout: 20_000 });
    await expect(history).toContainText('Submitted for approval', { timeout: 20_000 });

    // 2. The project manager raises the next two requests on the same work order.
    await pm.signIn(page);
    for (const code of ['FIL', 'CMP']) {
      await page.goto(`/work-orders/${woId}`);
      await expect(section.getByRole('button', { name: 'Request a quantity change' })).toBeEnabled({ timeout: 30_000 });
      await section.getByRole('button', { name: 'Request a quantity change' }).click();
      dialog = page.getByRole('dialog');
      const nextLine = dialog.getByTestId('qcr-raise-line').filter({ hasText: `${code}-${run.slice(-4)}` });
      await nextLine.getByLabel(/^Requested total quantity/).fill('125');
      await nextLine.getByLabel('Reason').fill('Additional depth confirmed on site');
      await dialog.getByRole('button', { name: 'Create draft' }).click();
      await expect(page).toHaveURL(/\/quantity-changes\/[0-9a-f-]{36}$/, { timeout: 20_000 });
      await page.getByRole('button', { name: 'Submit for approval' }).click();
      await expect(page.getByTestId('qcr-status')).toHaveAttribute('data-status', 'pending_approval', { timeout: 20_000 });
    }

    // 3. Three requests are used: the work order refuses a fourth, naming the limit.
    await page.goto(`/work-orders/${woId}`);
    await expect(section).toContainText('3 / 3', { timeout: 30_000 });
    await expect(section).toContainText('This work order has reached its request limit');
    await expect(section.getByRole('button', { name: 'Request a quantity change' })).toBeDisabled();
    expect(requestUrl).toMatch(/\/quantity-changes\//);
    await expect(page.getByTestId('wo-qcr-count')).toContainText('3 / 3');
    expect(wo.id).toBe(woId);

    // 4. #2883: finance approves the first request, the project manager records the send and the client's acceptance,
    //    and the work order's version history shows the reason the request gave.
    const requestId = requestUrl.split('/').pop() ?? '';
    const approved = await (await asUser('finance@acme.test')).rpc('qcr_approve', { p_request_id: requestId });
    if (approved.error) throw new Error(`JOB-PC8 approve: ${approved.error.message}`);
    const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
    await page.goto(requestUrl);
    await expect(page.getByTestId('qcr-status')).toHaveAttribute('data-status', 'approved', { timeout: 20_000 });
    await page.getByTestId('qcr-file-input').setInputFiles({ name: 'letter.pdf', mimeType: 'application/pdf', buffer: PDF });
    await expect(page.getByTestId('qcr-file')).toContainText('letter.pdf', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Record sent to client' }).click();
    await page.getByRole('dialog').getByLabel('Client reference').fill('CLIENT-REF-PC8');
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByTestId('qcr-status')).toHaveAttribute('data-status', 'sent_to_client', { timeout: 15_000 });
    await page.getByTestId('qcr-file-input').setInputFiles({ name: 'acceptance.pdf', mimeType: 'application/pdf', buffer: PDF });
    await expect(page.getByTestId('qcr-files')).toContainText('acceptance.pdf', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Client accepted' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByTestId('qcr-status')).toHaveAttribute('data-status', 'client_accepted', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Version history' }).click();
    await expect(page.getByTestId('qcr-versions')).toContainText('Rock found below the design level');
  } finally {
    const { data: requests } = await svc.from('quantity_change_requests').select('id').eq('work_order_id', woId || '00000000-0000-0000-0000-000000000000');
    const requestIds = (requests ?? []).map((r) => r.id as string);
    const inList = requestIds.length ? `(${requestIds.map((id) => `'${id}'`).join(',')})` : '(null)';
    sqlAsOwner(`delete from public.quantity_change_request_lines where request_id in ${inList};
      delete from public.quantity_change_requests where id in ${inList};
      delete from public.quantity_overrun_notices where boq_item_id in (${boqIds.length ? boqIds.map((id) => `'${id}'`).join(',') : 'null'});
      delete from public.progress_assessment_quantities where boq_item_id in (${boqIds.length ? boqIds.map((id) => `'${id}'`).join(',') : 'null'});`);
    await cleanupAll(svc, [
      ['project_progress_entries', 'project_id', projectId ? [projectId] : []],
      ['work_order_lines', 'work_order_id', woId ? [woId] : []],
      ['boq_items', 'id', boqIds],
      ['work_orders', 'id', woId ? [woId] : []],
      ['projects', 'id', projectId ? [projectId] : []],
    ]);
    ok('limit restore', await svc.from('organizations').update({ quantity_change_limit: priorLimit }).eq('id', ORG_ID));
    await pcm.cleanup();
    await pm.cleanup();
  }
});
