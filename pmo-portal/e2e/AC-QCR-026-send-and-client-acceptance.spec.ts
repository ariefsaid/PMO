// @e2e-isolation: self-isolated — creates its own uniquely-named project, work order and over-contract line each run and removes them (requests, versions, files, uploaded objects) afterwards; touches no shared seed row.
/**
 * AC-QCR-026 — quantity change request (#2578): from an approved request to the client's acceptance. The Project Manager
 * attaches the letter and records it as sent, attaches the client's reply and records the acceptance; the contract line then
 * holds the new quantity and its version history lists both versions.
 * Goal oracle: the request is `client_accepted`, the contract quantity is the requested one, and versions 1 and 2 are listed.
 * Setup (raise, submit, approve) goes through the real functions as the two seeded users; the steps under test are the UI's.
 */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';
import { asUser, cleanFixture, makeFixture, type QcrFixture } from './qcrFixture';

test.setTimeout(150_000);
test.use({ viewport: { width: 390, height: 844 } });

let fx: QcrFixture | undefined;
test.beforeEach(async () => { fx = await makeFixture('AC-QCR-026'); });
test.afterEach(async () => { await cleanFixture(fx); fx = undefined; });

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

test('AC-QCR-026 the PM records the send and the client acceptance, and the contract line holds the new quantity with both versions', async ({ page }) => {
  const f = fx!;
  const pm = await asUser('pm@acme.test');
  const raised = await pm.rpc('qcr_raise', {
    p_work_order_id: f.workOrderId, p_client_request_id: crypto.randomUUID(), p_note: null,
    p_lines: [{ boq_item_id: f.boqItemId, requested_quantity: '130', reason: 'Rock found below the design level' }],
  });
  if (raised.error) throw new Error(`AC-QCR-026 raise: ${raised.error.message}`);
  const requestId = raised.data as string;
  const submitted = await pm.rpc('qcr_submit', { p_request_id: requestId });
  if (submitted.error) throw new Error(`AC-QCR-026 submit: ${submitted.error.message}`);
  const finance = await asUser('finance@acme.test');
  const approved = await finance.rpc('qcr_approve', { p_request_id: requestId });
  if (approved.error) throw new Error(`AC-QCR-026 approve: ${approved.error.message}`);

  await signIn(page, 'pm@acme.test');
  await page.goto(`/quantity-changes/${requestId}`);
  await expect(page.getByTestId('qcr-status')).toHaveAttribute('data-status', 'approved', { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Record sent to client' })).toBeDisabled();

  await page.getByTestId('qcr-file-input').setInputFiles({ name: 'letter.pdf', mimeType: 'application/pdf', buffer: PDF });
  await expect(page.getByTestId('qcr-file')).toContainText('letter.pdf', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Record sent to client' }).click();
  const sent = page.getByRole('dialog');
  await sent.getByLabel('Client reference').fill('CLIENT-REF-77');
  await sent.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByTestId('qcr-status')).toHaveAttribute('data-status', 'sent_to_client', { timeout: 15_000 });
  await expect(page.getByTestId('qcr-client')).toContainText('CLIENT-REF-77');

  await page.getByTestId('qcr-file-input').setInputFiles({ name: 'acceptance.pdf', mimeType: 'application/pdf', buffer: PDF });
  await expect(page.getByTestId('qcr-files')).toContainText('acceptance.pdf', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Client accepted' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByTestId('qcr-status')).toHaveAttribute('data-status', 'client_accepted', { timeout: 15_000 });

  await page.getByRole('button', { name: 'Version history' }).click();
  const versions = page.getByTestId('qcr-versions');
  await expect(versions).toContainText('Version 1');
  await expect(versions).toContainText('Version 2');
  await expect(versions).toContainText('130');
  await expect(page.getByTestId('qcr-version-change')).toContainText('1,500.00'); // (130 - 100) x 50

  const line = await f.admin.from('boq_items').select('quantity').eq('id', f.boqItemId).single();
  expect(Number(line.data!.quantity)).toBe(130);
  const allocation = await f.admin.from('work_order_lines').select('quantity').eq('work_order_id', f.workOrderId).single();
  expect(Number(allocation.data!.quantity)).toBe(90); // 60 + (130 - 100)
});
