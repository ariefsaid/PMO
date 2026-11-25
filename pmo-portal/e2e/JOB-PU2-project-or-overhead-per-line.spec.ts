// @e2e-isolation: self-isolated — owns its Buyer login, project, work order and request; reads the organisation's two starter line categories without changing them.
// JOB-PU2 (acceptance 06-procurement-finance-equipment, TC-PFE-02): project or overhead per line. The Buyer raises a request
// with two lines, sets one to a work order (category Project) and one to overhead (no work order, category Overhead);
// after saving, each line shows its own category.
import { test, expect } from '@playwright/test';
import { cleanupAll, need, ORG_ID, runId, serviceClient, sqlAsOwner } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(120_000);

test('JOB-PU2 the Buyer sets one line to a work order and one to overhead, and each line shows its own category', async ({ page }) => {
  const admin = serviceClient('JOB-PU2');
  const run = runId('JOBPU2');
  const buyer = await roleJobUser(admin, 'buyer', run);
  let projectId = ''; let woId = ''; let requestId = '';
  try {
    const categories = need('categories', await admin.from('purchase_line_categories').select('id,name').eq('org_id', ORG_ID).is('archived_at', null).in('name', ['Project', 'Overhead']));
    expect(categories.map((c) => c.name).sort()).toEqual(['Overhead', 'Project']);
    projectId = need('project', await admin.from('projects').insert({ org_id: ORG_ID, name: `${run} project`, status: 'Ongoing Project', currency: 'USD' }).select('id').single()).id as string;
    woId = need('work order', await admin.from('work_orders').insert({
      org_id: ORG_ID, project_id: projectId, title: `${run} order`, wo_number: `WO-${run}`, status: 'Issued', order_value: 1000,
      tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD',
    }).select('id').single()).id as string;

    await buyer.signIn(page);
    await page.goto(`/procurement/new?project=${projectId}&have=need`);
    await page.getByLabel(/title/i).first().fill(`${run} request`);
    const addRow = page.getByTestId('line-items-section').getByRole('row').filter({ hasText: 'New line' });
    for (const name of [`${run} site pipe`, `${run} office paper`]) {
      await addRow.getByLabel(/new item description/i).fill(name);
      await addRow.getByLabel(/new item quantity/i).fill('1');
      await addRow.getByLabel(/new item unit price/i).fill('100');
      await addRow.getByRole('button', { name: /add line item/i }).click();
    }
    // Line one is for the work order; line two stays on no work order (overhead).
    await page.getByTestId('line-work-orders-section').getByRole('combobox', { name: `Work order for ${run} site pipe` }).selectOption({ label: `WO-${run}` });
    const planning = page.getByTestId('line-planning-section');
    const rowOf = (name: string) => planning.getByRole('listitem').filter({ hasText: name });
    await rowOf(`${run} site pipe`).getByLabel('Line category').selectOption({ label: 'Project' });
    await rowOf(`${run} office paper`).getByLabel('Line category').selectOption({ label: 'Overhead' });
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page).toHaveURL(/\/procurement\/[0-9a-f-]{36}/, { timeout: 30_000 });
    requestId = page.url().match(/\/procurement\/([0-9a-f-]{36})/)?.[1] ?? '';

    // Each line shows its own category on the saved request.
    await page.getByRole('tab', { name: /line items/i }).click();
    const panel = page.getByTestId('line-planning-panel');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(rowOfPanel(panel, `${run} site pipe`).getByLabel('Line category')).toHaveValue(categories.find((c) => c.name === 'Project')!.id);
    await expect(rowOfPanel(panel, `${run} office paper`).getByLabel('Line category')).toHaveValue(categories.find((c) => c.name === 'Overhead')!.id);
    const lines = need('lines', await admin.from('procurement_items').select('name,work_order_id').eq('procurement_id', requestId));
    expect(lines.find((l) => l.name === `${run} site pipe`)?.work_order_id).toBe(woId);
    expect(lines.find((l) => l.name === `${run} office paper`)?.work_order_id).toBeNull();
  } finally {
    if (requestId) sqlAsOwner(`delete from procurement_create_intents where procurement_id = '${requestId}';`);
    await cleanupAll(admin, [['purchase_requests', 'procurement_id', requestId ? [requestId] : []], ['procurement_items', 'procurement_id', requestId ? [requestId] : []], ['procurements', 'id', requestId ? [requestId] : []], ['work_orders', 'id', woId ? [woId] : []], ['projects', 'id', projectId ? [projectId] : []]]);
    await buyer.cleanup();
  }
});

function rowOfPanel(panel: import('@playwright/test').Locator, name: string) {
  return panel.getByRole('listitem').filter({ hasText: name });
}
