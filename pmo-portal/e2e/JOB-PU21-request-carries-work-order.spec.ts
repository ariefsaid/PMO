// @e2e-isolation: self-isolated — creates its own project with exactly one open work order, discipline and a supplier-less request on it (service role), and removes them afterwards.
/**
 * JOB-PU21 — cost is attributed where it is entered: a Project Manager raises a request on a project that has one open work order;
 * the work order is already chosen on the request form; the request carries it, and when the order is recorded and the goods
 * are received, the receipt form starts on the same work order. Nothing lands on "project level" by default.
 */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';
import { serviceClient, SEED_SUPPLIER_ID } from './procurement-fixture';

test.setTimeout(180_000);

const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const PM_ID = '00000000-0000-0000-0000-0000000000a2';

test('JOB-PU21 the request starts on the project\'s only open work order and the cost follows it to the order and receipt', async ({ page }) => {
  const admin = serviceClient();
  const tag = `JOB-PU21 ${Date.now()}`;
  const project = (await admin.from('projects').insert({ org_id: ORG_ID, name: tag, status: 'Ongoing Project', project_manager_id: PM_ID }).select('id').single()).data;
  if (!project) throw new Error('JOB-PU21 could not create its project');
  const workOrder = (await admin.from('work_orders').insert({ org_id: ORG_ID, project_id: project.id, title: `${tag} pump house`, status: 'Issued', order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0 }).select('id').single()).data;
  if (!workOrder) throw new Error('JOB-PU21 could not create its work order');
  const discipline = (await admin.from('cost_disciplines').insert({ org_id: ORG_ID, code: `D${Date.now() % 100000}`, name: `${tag} Piping` }).select('id').single()).data;
  if (!discipline) throw new Error('JOB-PU21 could not create its discipline');
  let procurementId: string | null = null;
  try {
    await signIn(page, 'pm@acme.test');
    await page.goto(`/procurement/new?have=need&project=${project.id}&title=${encodeURIComponent(tag)}&lineName=Pipe&lineQty=3&lineRate=15000000`);
    // The work order is already chosen: no "project level" default. Combobox role avoids ambiguity with the adjacent clear button.
    const picker = page.getByRole('combobox', { name: 'Work order' });
    await expect(picker).toContainText(`${tag} pump house`, { timeout: 20_000 });
    // Pick the discipline on the request form so cost attribution carries through.
    await page.getByRole('combobox', { name: 'Discipline' }).click();
    await page.locator('div[role="option"]', { hasText: `${tag} Piping` }).click();
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page).toHaveURL(/\/procurement\/[0-9a-f-]{36}/, { timeout: 20_000 });
    procurementId = page.url().match(/\/procurement\/([0-9a-f-]{36})/)?.[1] ?? null;
    expect(procurementId).not.toBeNull();
    const row = (await admin.from('procurements').select('work_order_id, discipline_id').eq('id', procurementId as string).single()).data;
    expect(row?.work_order_id).toBe(workOrder.id);
    expect(row?.discipline_id).toBe(discipline.id);

    // Request → approve → supplier → order, as the database does for the later records (the journey asserts where the cost lands).
    await admin.from('procurements').update({ vendor_id: SEED_SUPPLIER_ID, status: 'Approved', approved_by_id: '00000000-0000-0000-0000-0000000000a1' }).eq('id', procurementId as string);
    await page.goto(`/procurement/${procurementId}`);
    await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Approved', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Record order' }).first().click();
    const confirm = page.getByRole('dialog').filter({ hasText: 'Record this order?' });
    await confirm.getByRole('button', { name: 'Record order' }).click();
    await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Ordered', { timeout: 15_000 });
    const order = (await admin.from('purchase_orders').select('work_order_id, discipline_id').eq('procurement_id', procurementId as string).single()).data;
    expect(order?.work_order_id).toBe(workOrder.id);
    expect(order?.discipline_id).toBe(discipline.id);

    // The receipt form starts on the same work order and carries the discipline.
    await page.getByRole('button', { name: 'Record receipt' }).first().click();
    const receiptForm = page.getByTestId('form-create-gr');
    await expect(receiptForm).toBeVisible({ timeout: 10_000 });
    await expect(receiptForm.getByRole('combobox', { name: 'Work order' })).toContainText(`${tag} pump house`);
    await expect(receiptForm.getByRole('combobox', { name: 'Discipline' })).toContainText(`${tag} Piping`);

    // Finish actual receipt save and confirm, proving the stored row carries work order and discipline.
    await receiptForm.getByTestId('btn-save-gr').click();
    const confirmGR = page.getByRole('dialog').filter({ hasText: /Record this goods receipt\?/i });
    await expect(confirmGR).toBeVisible({ timeout: 10_000 });
    await confirmGR.getByRole('button', { name: 'Save GR' }).click();
    await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Received', { timeout: 15_000 });

    const receipt = (await admin.from('procurement_receipts').select('work_order_id, discipline_id').eq('procurement_id', procurementId as string).single()).data;
    expect(receipt?.work_order_id).toBe(workOrder.id);
    expect(receipt?.discipline_id).toBe(discipline.id);
  } finally {
    if (procurementId) {
      for (const table of ['procurement_receipts', 'purchase_orders', 'purchase_requests', 'procurement_status_events', 'procurement_items']) {
        await admin.from(table).delete().eq('procurement_id', procurementId);
      }
      await admin.from('procurements').delete().eq('id', procurementId);
    }
    await admin.from('work_orders').delete().eq('id', workOrder.id);
    await admin.from('cost_disciplines').delete().eq('id', discipline.id);
    await admin.from('projects').delete().eq('id', project.id);
  }
});
