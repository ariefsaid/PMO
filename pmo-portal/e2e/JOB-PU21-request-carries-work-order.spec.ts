// @e2e-isolation: self-isolated — creates its own project with exactly one open work order, discipline and a supplier-less request on it (service role), and removes them afterwards.
/**
 * JOB-PU21 — cost is attributed where it is entered: a Project Manager raises a request on a project that has one open work order;
 * the work order is already chosen on the request form; the request carries it, and when the order is recorded and the goods
 * are received, the receipt form starts on the same work order. Nothing lands on "project level" by default.
 */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';
import { serviceClient, SEED_SUPPLIER_ID } from './procurement-fixture';
import { need, ok, cleanupAll } from './support/jobFixtures';

test.setTimeout(180_000);

const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const PM_ID = '00000000-0000-0000-0000-0000000000a2';

test('JOB-PU21 the request starts on the project\'s only open work order and the cost follows it to the order and receipt', async ({ page }) => {
  const admin = serviceClient();
  const tag = `JOB-PU21 ${Date.now()}`;
  let projectId: string | null = null;
  let workOrderId: string | null = null;
  let disciplineId: string | null = null;
  let procurementId: string | null = null;
  let journeyError: unknown = null;

  try {
    const project = need('JOB-PU21 project', await admin.from('projects').insert({
      org_id: ORG_ID, name: tag, status: 'Ongoing Project', project_manager_id: PM_ID,
    }).select('id').single());
    projectId = project.id as string;

    const workOrder = need('JOB-PU21 work order', await admin.from('work_orders').insert({
      org_id: ORG_ID, project_id: projectId, title: `${tag} pump house`, status: 'Issued',
      order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0,
    }).select('id').single());
    workOrderId = workOrder.id as string;

    const discipline = need('JOB-PU21 discipline', await admin.from('cost_disciplines').insert({
      org_id: ORG_ID, code: `D${Date.now()}`, name: `${tag} Piping`,
    }).select('id').single());
    disciplineId = discipline.id as string;

    await signIn(page, 'pm@acme.test');
    await page.goto(`/procurement/new?have=need&project=${projectId}&title=${encodeURIComponent(tag)}&lineName=Pipe&lineQty=3&lineRate=15000000`);

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

    const row = need('JOB-PU21 read procurement', await admin.from('procurements').select('work_order_id, discipline_id').eq('id', procurementId as string).single());
    expect(row.work_order_id).toBe(workOrderId);
    expect(row.discipline_id).toBe(disciplineId);

    // Request → approve → supplier → order, as the database does for the later records (the journey asserts where the cost lands).
    ok('JOB-PU21 approve', await admin.from('procurements').update({
      vendor_id: SEED_SUPPLIER_ID,
      status: 'Approved',
      approved_by_id: '00000000-0000-0000-0000-0000000000a1',
    }).eq('id', procurementId as string));

    await page.goto(`/procurement/${procurementId}`);
    await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Approved', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Record order' }).first().click();
    const confirm = page.getByRole('dialog').filter({ hasText: 'Record this order?' });
    await confirm.getByRole('button', { name: 'Record order' }).click();
    await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Ordered', { timeout: 15_000 });

    const order = need('JOB-PU21 read order', await admin.from('purchase_orders').select('work_order_id, discipline_id').eq('procurement_id', procurementId as string).single());
    expect(order.work_order_id).toBe(workOrderId);
    expect(order.discipline_id).toBe(disciplineId);

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

    // Poll the stored procurement_receipts row for work_order_id and discipline_id:
    // Received status is advanced inside the createReceipt transaction, while the second attribution RPC runs immediately afterwards.
    await expect.poll(async () => {
      const { data, error } = await admin.from('procurement_receipts')
        .select('work_order_id, discipline_id')
        .eq('procurement_id', procurementId as string)
        .maybeSingle();
      if (error) throw new Error(`query receipt: ${error.message}`);
      return { wo: data?.work_order_id ?? null, disc: data?.discipline_id ?? null };
    }, { timeout: 10_000 }).toEqual({ wo: workOrderId, disc: disciplineId });
  } catch (err) {
    journeyError = err;
  }

  // Teardown runs after the journey, never in `finally`: a throw inside `finally` is unsafe (it can mask
  // the journey's own failure) and ESLint rightly rejects it. Carry both outcomes out to Playwright instead.
  let cleanupError: unknown = null;
  try {
    if (!procurementId && projectId) {
      const fallback = await admin.from('procurements').select('id').eq('project_id', projectId).eq('title', tag).maybeSingle();
      if (fallback.data?.id) procurementId = fallback.data.id;
    }
    await cleanupAll(admin, [
      ['procurement_receipts', 'procurement_id', procurementId ? [procurementId] : []],
      ['purchase_orders', 'procurement_id', procurementId ? [procurementId] : []],
      ['purchase_requests', 'procurement_id', procurementId ? [procurementId] : []],
      ['procurement_status_events', 'procurement_id', procurementId ? [procurementId] : []],
      ['procurement_items', 'procurement_id', procurementId ? [procurementId] : []],
      ['procurements', 'id', procurementId ? [procurementId] : []],
      ['work_orders', 'id', workOrderId ? [workOrderId] : []],
      ['cost_disciplines', 'id', disciplineId ? [disciplineId] : []],
      ['projects', 'id', projectId ? [projectId] : []],
    ]);
  } catch (err) {
    cleanupError = err;
  }

  if (journeyError && cleanupError) {
    const jMsg = journeyError instanceof Error ? journeyError.message : String(journeyError);
    const cMsg = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
    const combined = new Error(`${jMsg} (cleanup also failed: ${cMsg})`);
    combined.stack = journeyError instanceof Error ? journeyError.stack : undefined;
    throw combined;
  }
  if (journeyError) throw journeyError;
  if (cleanupError) throw cleanupError;
});
