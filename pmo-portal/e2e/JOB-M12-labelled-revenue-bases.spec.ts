// @e2e-isolation: self-isolated — disposable tenant, Executive login and its own invoices, claim and progress.
import { test, expect } from '@playwright/test';
import { serviceClient, need } from './support/jobJourney';
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
    const day = new Date().toISOString().slice(0, 10);
    const report = must('validated report', await db.from('daily_site_reports').insert({ org_id: org.id, project_id: project.id, work_order_id: wo.id, work_date: day, status: 'validated', author_id: executive.id, validated_by: administrator.id, validated_at: new Date().toISOString() }).select('id').single());
    must('earned progress', await db.from('dsr_progress_lines').insert({ org_id: org.id, report_id: report.id, position: 1, work_order_line_id: line.id, quantity: 12.5, unit: 'm', frozen_rate: 10, frozen_amount: 125, frozen_rate_source: 'contract', frozen_at: new Date().toISOString() }).select('id'));
    must('invoice', await db.from('sales_invoices').insert({ org_id: org.id, project_id: project.id, work_order_id: wo.id, customer_id: client.id, si_number: 'SI-A', invoice_date: day, amount: 50, currency: 'EUR', tax_treatment: 'exclusive', tax_amount: 0, status: 'Unpaid' }).select('id'));
    must('pending claim', await db.from('progress_claims').insert({ org_id: org.id, project_id: project.id, work_order_id: wo.id, kind: 'progress', currency: 'EUR', gross_amount: 30, created_by: administrator.id }).select('id'));
    await executive.signIn(page);
    await page.goto(`/projects/${project.id}/orders`);
    const panel = page.getByTestId('earned-billed');
    const fmt = (value: string) => formatExactMoney(value, 'EUR', 'en-US')!;
    await expect(panel.getByTestId(`earned-billed-row-${wo.id}-billed`)).toHaveText(fmt('80.00'));
    const total = panel.getByTestId('earned-billed-row-total-billed');
    await expect(total).toContainText(`Invoiced: ${fmt('50.00')}`);
    await expect(total).toContainText(`Claimed: ${fmt('80.00')}`);
    await expect(panel.getByTestId('earned-billed-discipline-unitemised-billed')).toHaveText(fmt('80.00'));
    await expect(panel.getByTestId('earned-billed-row-total-earned')).toHaveText('Incomplete: some work orders have no validated progress');
  } finally {
    removeJobOrganization(org.id);
    await administrator.remove();
    await executive.remove();
  }
});
