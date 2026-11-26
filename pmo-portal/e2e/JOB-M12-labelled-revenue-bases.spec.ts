// @e2e-isolation: self-isolated — disposable tenant, Executive login and its own invoices, claim and progress.
import { test, expect } from '@playwright/test';
import { serviceClient, need, orgToday } from './support/jobJourney';
import { createJobRoleUser, removeJobOrganization } from './support/jobRoleUser';
import { formatExactMoney } from '../src/lib/format';

test.setTimeout(120000);
test('JOB-M12 executive reconciles claimed work with invoices while missing progress remains explicit', async ({ page }) => {
  const db = serviceClient('JOB-M12');
  const must = need('JOB-M12');
  const org = must('organisation', await db.from('organizations').insert({ name: `Revenue ${crypto.randomUUID()}`, default_currency: 'EUR', built_in_roles_enabled: true, discipline_profit_enabled: true }).select('id').single());
  const executive = await createJobRoleUser(db, org.id, 'executive');
  const administrator = await createJobRoleUser(db, org.id, 'administrator');
  try {
    const client = must('client', await db.from('companies').insert({ org_id: org.id, name: 'Project client', type: 'Client' }).select('id').single());
    const project = must('project', await db.from('projects').insert({ org_id: org.id, name: 'Revenue work', client_id: client.id, status: 'Ongoing Project', currency: 'EUR', contract_value: 10000, tax_treatment: 'exclusive', tax_amount: 0 }).select('id').single());
    const orders = must('orders', await db.from('work_orders').insert(['A', 'B'].map(code => ({ org_id: org.id, project_id: project.id, title: `Work ${code}`, wo_number: `WO-${code}`, status: 'Issued', order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'EUR' }))).select('id,wo_number'));
    const wo = orders.find(row => row.wo_number === 'WO-A')!;
    const boq = must('contract line', await db.from('boq_items').insert({ org_id: org.id, project_id: project.id, item_code: 'A', description: 'Measured work', unit: 'm', quantity: 100, rate: 10 }).select('id').single());
    const line = must('allocation', await db.from('work_order_lines').insert({ org_id: org.id, work_order_id: wo.id, boq_item_id: boq.id, quantity: 100 }).select('id').single());
    const day = orgToday();
    const report = must('validated report', await db.from('daily_site_reports').insert({ org_id: org.id, project_id: project.id, work_order_id: wo.id, work_date: day, status: 'validated', author_id: executive.id, validated_by: administrator.id, validated_at: new Date().toISOString() }).select('id').single());
    must('earned progress', await db.from('dsr_progress_lines').insert({ org_id: org.id, report_id: report.id, position: 1, work_order_line_id: line.id, quantity: 12.5, unit: 'm', frozen_rate: 10, frozen_amount: 125, frozen_rate_source: 'contract', frozen_at: new Date().toISOString() }).select('id'));
    must('invoice', await db.from('sales_invoices').insert({ org_id: org.id, project_id: project.id, work_order_id: wo.id, customer_id: client.id, si_number: 'SI-A', invoice_date: day, amount: 50, currency: 'EUR', tax_treatment: 'exclusive', tax_amount: 0, status: 'Unpaid' }).select('id'));
    must('pending claim', await db.from('progress_claims').insert({ org_id: org.id, project_id: project.id, work_order_id: wo.id, kind: 'progress', currency: 'EUR', gross_amount: 30, created_by: administrator.id }).select('id'));
    // Work B also has validated progress (4 m at 10 = 40), so every work order is complete and the totals are sums.
    const woB = orders.find(row => row.wo_number === 'WO-B')!;
    const boqB = must('contract line B', await db.from('boq_items').insert({ org_id: org.id, project_id: project.id, item_code: 'B', description: 'Measured work B', unit: 'm', quantity: 100, rate: 10 }).select('id').single());
    const lineB = must('allocation B', await db.from('work_order_lines').insert({ org_id: org.id, work_order_id: woB.id, boq_item_id: boqB.id, quantity: 100 }).select('id').single());
    const reportB = must('validated report B', await db.from('daily_site_reports').insert({ org_id: org.id, project_id: project.id, work_order_id: woB.id, work_date: day, status: 'validated', author_id: executive.id, validated_by: administrator.id, validated_at: new Date().toISOString() }).select('id').single());
    must('earned progress B', await db.from('dsr_progress_lines').insert({ org_id: org.id, report_id: reportB.id, position: 1, work_order_line_id: lineB.id, quantity: 4, unit: 'm', frozen_rate: 10, frozen_amount: 40, frozen_rate_source: 'contract', frozen_at: new Date().toISOString() }).select('id'));
    await executive.signIn(page);
    await page.goto(`/projects/${project.id}/orders`);
    const panel = page.getByTestId('earned-billed');
    const fmt = (value: string) => formatExactMoney(value, 'EUR', 'en-US')!;
    // First load after a database reset with three browsers competing: the earned-billed data landed
    // ~11.7 s after navigation in the failing full run (4.7 s of that before `load`), so the first
    // assertion gets the sibling journeys' 20-second wait.
    await expect(panel.getByTestId(`earned-billed-row-${wo.id}-billed`)).toHaveText(fmt('80.00'), { timeout: 20_000 });
    // The gap sits beside them: earned 125.00 less billed 80.00 = 45.00.
    await expect(panel.getByTestId(`earned-billed-row-${wo.id}-earned`)).toHaveText(fmt('125.00'));
    await expect(panel.getByTestId(`earned-billed-row-${wo.id}-gap`)).toHaveText(fmt('45.00'));
    const total = panel.getByTestId('earned-billed-row-total-billed');
    await expect(total).toContainText(`Invoiced: ${fmt('50.00')}`);
    await expect(total).toContainText(`Claimed: ${fmt('80.00')}`);
    await expect(panel.getByTestId('earned-billed-discipline-unitemised-billed')).toHaveText(fmt('80.00'));
    // Project total: earned is the sum of the work orders (125 + 40); the gap is that less the project's invoiced 50.
    await expect(panel.getByTestId(`earned-billed-row-${woB.id}-earned`)).toHaveText(fmt('40.00'));
    await expect(panel.getByTestId('earned-billed-row-total-earned')).toHaveText(fmt('165.00'));
    await expect(panel.getByTestId('earned-billed-row-total-gap')).toHaveText(fmt('115.00'));
    // Discipline view (both contract lines carry no discipline): earned adds up to the same 165; billed work no claim line itemises is the 80.
    await expect(panel.getByTestId('earned-billed-discipline-none-earned')).toHaveText(fmt('165.00'));
    await expect(panel.getByTestId('earned-billed-discipline-none-billed')).toHaveText(fmt('0.00'));
  } finally {
    removeJobOrganization(org.id);
    await administrator.remove();
    await executive.remove();
  }
});
