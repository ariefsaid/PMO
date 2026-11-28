// @e2e-isolation: self-isolated — its own organisation, role login, project, work order, unpaid bill, unapproved timesheet and issued stock; deletes the organisation and its users in finally.
// JOB-PC31 (#3026): a project control manager opening a work order whose direct cost is 0 sees a collapsed "Not yet counted" line
// and can expand it to see unpaid supplier bills, unapproved labour (count only), and issued stock (excluding zero-cost stock) with setting-off notes.
import { test, expect } from '@playwright/test';
import { formatTableMoney } from '../src/lib/format';
import { inDays, orgToday, serviceClient, need } from './support/jobJourney';
import { createJobRoleUser, removeJobOrganization } from './support/jobRoleUser';
import { sqlAsOwner } from './support/jobFixtures';
import { openWorkOrderArea } from './support/workOrderArea';

test.setTimeout(180_000);

test('JOB-PC31 project control manager sees what work-order direct cost leaves out', async ({ page }) => {
  const db = serviceClient('JOB-PC31');
  const must = need('JOB-PC31');
  const org = must('organisation', await db.from('organizations').insert({
    name: `WO left out ${crypto.randomUUID()}`, default_currency: 'USD', built_in_roles_enabled: true,
  }).select('id').single());
  const pcm = await createJobRoleUser(db, org.id, 'project_control_manager');
  const engineer = await createJobRoleUser(db, org.id, 'engineer');
  const day = orgToday();
  const week = inDays(-(((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7)));

  try {
    const project = must('project', await db.from('projects').insert({
      org_id: org.id, name: 'Jetty repair', status: 'Ongoing Project', currency: 'USD', project_manager_id: pcm.id,
    }).select('id').single());
    const wo = must('work order', await db.from('work_orders').insert({
      org_id: org.id, project_id: project.id, title: 'Deck welding', status: 'Issued', order_value: 50_000,
      tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD',
    }).select('id').single());

    // 1. Unpaid supplier bill (4,000 USD pre-tax) on the work order.
    const proc = must('purchase', await db.from('procurements').insert({
      org_id: org.id, project_id: project.id, work_order_id: wo.id, title: 'Welding rods',
      requested_by_id: pcm.id, status: 'Vendor Invoiced', total_value: 4_000, approved_total_value: 4_000, currency: 'USD',
    }).select('id').single());
    must('unpaid bill', await db.from('procurement_invoices').insert({
      org_id: org.id, procurement_id: proc.id, work_order_id: wo.id, vi_number: 'VI-PC31-1',
      invoice_date: day, status: 'Received', amount: 4_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD',
    }).select('id'));

    // 2. Unapproved (Submitted) timesheet entry on the work order (count only).
    const sheet = must('timesheet', await db.from('timesheets').insert({
      org_id: org.id, user_id: engineer.id, week_start_date: week, status: 'Draft',
    }).select('id').single());
    must('timesheet entry', await db.from('timesheet_entries').insert({
      org_id: org.id, timesheet_id: sheet.id, project_id: project.id, work_order_id: wo.id, entry_date: day, hours: 8,
    }).select('id'));
    must('submit timesheet', await db.from('timesheets').update({
      status: 'Submitted', submitted_at: new Date().toISOString(),
    }).eq('id', sheet.id).select('id'));

    // 3. Posted stock issue (1,200 USD) while stock issue costing is OFF, plus a zero-cost issue (excluded).
    const unit = must('stock unit', await db.from('stock_units').insert({
      org_id: org.id, code: 'ea', name: 'each',
    }).select('id').single());
    const itemPriced = must('stock item', await db.from('stock_items').insert({
      org_id: org.id, code: 'PLATE', name: 'Steel plate', unit_id: unit.id,
    }).select('id').single());
    const itemFree = must('free stock item', await db.from('stock_items').insert({
      org_id: org.id, code: 'FREE-V', name: 'Client valve', unit_id: unit.id,
    }).select('id').single());
    const wh = must('warehouse', await db.from('stock_warehouses').insert({
      org_id: org.id, code: 'WH-PC31', name: 'Main store', kind: 'central',
    }).select('id').single());

    // Posted stock is written only by the posting engine (no direct write for the service role), so the posted documents,
    // their lines and ledger rows are seeded as the database owner, exactly as the engine would leave them.
    const posted = new Date().toISOString();
    const stock = (number: string, itemId: string, qty: number, value: number) => {
      const doc = crypto.randomUUID();
      const line = crypto.randomUUID();
      return `insert into public.stock_documents (id, org_id, number, kind, status, warehouse_id, project_id, work_order_id, occurred_on, created_by, posted_by, posted_at)
          values ('${doc}', '${org.id}', '${number}', 'issue', 'Posted', '${wh.id}', '${project.id}', '${wo.id}', '${day}', '${pcm.id}', '${pcm.id}', '${posted}');
        insert into public.stock_document_lines (id, org_id, document_id, line_no, item_id, quantity, direction)
          values ('${line}', '${org.id}', '${doc}', 1, '${itemId}', ${qty}, 'out');
        insert into public.stock_ledger (org_id, document_id, line_id, item_id, warehouse_id, project_id, kind, qty_delta, value_delta, qty_after, value_after, occurred_on, posted_by)
          values ('${org.id}', '${doc}', '${line}', '${itemId}', '${wh.id}', '${project.id}', 'issue', ${-qty}, ${-value}, 0, 0, '${day}', '${pcm.id}');`;
    };
    sqlAsOwner(stock('SI-PC31-1', itemPriced.id, 3, 1_200) + stock('SI-PC31-2', itemFree.id, 1, 0));

    // Sign in as project_control_manager and open the work order's Cost and plan tab.
    await pcm.signIn(page);
    await page.goto(`/work-orders/${wo.id}`);
    await openWorkOrderArea(page, 'cost');

    // Direct cost is still 0 (nothing paid/approved/enabled), and the single collapsed left-out line appears with 3 records (zero-cost stock excluded).
    const toggle = page.getByTestId('wo-cost-left-out-toggle');
    await expect(toggle).toBeVisible({ timeout: 30_000 });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toContainText('Not yet counted: 3 records');

    // Expand and verify each kind, count, total, and setting-off note.
    await toggle.click();
    await expect(page.getByTestId('wo-cost-left-out-list')).toBeVisible();
    await expect(page.getByTestId('wo-cost-left-out-item-unpaid_bill')).toContainText(formatTableMoney('4000.00', 'USD') ?? '4,000');
    await expect(page.getByTestId('wo-cost-left-out-item-uncounted_stock')).toContainText(formatTableMoney('1200.00', 'USD') ?? '1,200');
    await expect(page.getByTestId('wo-cost-left-out-item-uncounted_stock')).toContainText('Stock issue costing is off');
    await expect(page.getByTestId('wo-cost-left-out-amount-unapproved_labour')).toContainText('Count only');
  } finally {
    removeJobOrganization(org.id);
    await engineer.remove();
    await pcm.remove();
  }
});
