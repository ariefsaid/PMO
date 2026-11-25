// @e2e-isolation: serial — turns the organisation-wide material-request delivery note on (and sets its chain), which every material-request journey reads; both are restored in finally.
/** JOB-W2 — an approved material request gives the material coordinator a printable delivery note: it prints with the request's lines and the
 *  signature blocks. */
import { test, expect } from '@playwright/test';
import { signIn } from '../helpers';
import { ok, runId, serviceClient } from '../support/jobFixtures';
import { mrqSetup, submittedRequest } from '../support/mrqJobFixture';
import { roleJobUser } from '../support/roleJobUser';
import { makeWarehouse, runSuffix } from '../support/stockFixture';

test.setTimeout(180_000);

test('JOB-W2 material coordinator prints the delivery note of an approved request with its lines and signature blocks', async ({ page }) => {
  const svc = serviceClient('JOB-W2');
  const { admin, item, wo } = await mrqSetup([{ role: 'Admin', label: 'Stock' }]);
  const source = await makeWarehouse(admin, runSuffix(), 'MC', 'central');
  const coordinator = await roleJobUser(svc, 'material_coordinator', runId('w2-mc'));
  let noteEnabled = false;
  try {
    // The approved request is the case's precondition: the requester raises it, the Admin decides it and enables printing.
    const requestId = await submittedRequest('engineer@acme.test', wo.id, item.id);
    await signIn(page, 'admin@acme.test');
    await page.goto(`/material-requests/${requestId}`);
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
    await dialog.getByLabel(/warehouse the material leaves from/i).selectOption({ label: `${source.code} · ${source.name}` });
    await dialog.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    ok('delivery note on', await admin.rpc('mrq_set_delivery_note_settings', { p_enabled: true, p_signature_blocks: null }));
    noteEnabled = true;

    // 1. Material coordinator opens the request's delivery note.
    await coordinator.signIn(page);
    await page.goto(`/material-requests/${requestId}`);
    await page.getByRole('button', { name: 'Print delivery note' }).click();
    await expect(page.getByTestId('delivery-note-page')).toBeVisible({ timeout: 20_000 });

    // 2. Goal: it prints with the lines and the signature blocks.
    await expect(page.getByRole('heading', { name: /Delivery note/ }).first()).toBeVisible();
    await expect(page.getByText(item.code, { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId('delivery-note-page').getByText('2', { exact: true }).first()).toBeVisible();
    for (const block of ['Dispatched by', 'Delivered by', 'Received by']) {
      await expect(page.getByText(block, { exact: true })).toBeVisible();
    }

    // The delivery document behind it still carries the approved lines and quantities.
    await page.goto(`/material-requests/${requestId}`);
    await page.getByRole('link', { name: 'Open the delivery document' }).click();
    await expect(page).toHaveURL(/\/stock\/documents\/[0-9a-f-]{36}/, { timeout: 15_000 });
    await expect(page.getByRole('row').filter({ hasText: item.code }).first()).toContainText('2');
  } finally {
    if (noteEnabled) await admin.rpc('mrq_set_delivery_note_settings', { p_enabled: false, p_signature_blocks: null });
    await coordinator.cleanup();
  }
});
