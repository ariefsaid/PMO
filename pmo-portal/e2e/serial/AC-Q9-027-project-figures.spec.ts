// @e2e-isolation: serial — temporarily enables the organisation reporting setting and restores it in finally.
// AC-EBR-011 / AC-EBR-012 — with the setting on, the project tab shows earned beside billed revenue with the gap, and the management pack shows them per project.
// Goal oracle: earned (validated progress at the frozen rate, 125.00) and billed (an invoice excl. tax, 50.00) sit side by side with a gap of 75.00.
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { pinEnglishLocale, requireServiceRoleKey, signIn } from '../helpers';
import { formatExactMoney, formatTableMoney } from '../../src/lib/format';
import { requireMatchingLocalSupabaseUrls } from '../../src/lib/testing/localSupabaseUrl';

test.setTimeout(120_000);
test.use({ deviceScaleFactor: 2 });
test('AC-Q9-027 project manager reads project figures', async ({ page }) => {
  const serviceKey = requireServiceRoleKey();
  if (!serviceKey) throw new Error('AC-EBR-011 requires the local fixture service client');
  const admin: SupabaseClient = createClient(requireMatchingLocalSupabaseUrls(undefined, undefined), serviceKey, { auth: { persistSession: false } });
  const suffix = 'EBR-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  let orgId = '';
  let previousSetting = false;
  let companyId = '';
  let projectId = '';
  let workOrderId = '';
  let disciplineId = '';
  let boqId = '';
  let reportId = '';
  let invoiceId = '';
  let otherProjectId = '';
  let otherWorkOrderId = '';
  let failure: unknown;
  const cleanupFailures: string[] = [];
  const cleanup = async (label: string, op: () => PromiseLike<{ error: { message: string } | null }>) => {
    try { const r = await op(); if (r.error) cleanupFailures.push(label + ': ' + r.error.message); }
    catch (e) { cleanupFailures.push(label + ': ' + (e instanceof Error ? e.message : String(e))); }
  };

  try {
    const finance = await admin.from('profiles').select('id, org_id').eq('email', 'finance@acme.test').single();
    if (finance.error) throw new Error('AC-EBR-011 fixture profile: ' + finance.error.message);
    orgId = finance.data.org_id;
    const pm = await admin.from('profiles').select('id').eq('email','pm@acme.test').single();
    if (pm.error) throw pm.error;
    const author = await admin.from('profiles').select('id').eq('org_id', orgId).neq('id', finance.data.id).limit(1).single();
    if (author.error) throw new Error('AC-EBR-011 fixture author: ' + author.error.message);
    const org = await admin.from('organizations').select('discipline_profit_enabled').eq('id', orgId).single();
    if (org.error) throw new Error('AC-EBR-011 fixture org: ' + org.error.message);
    previousSetting = org.data.discipline_profit_enabled;
    const on = await admin.from('organizations').update({ discipline_profit_enabled: true }).eq('id', orgId);
    if (on.error) throw new Error('AC-EBR-011 setting: ' + on.error.message);

    const company = await admin.from('companies').insert({ org_id: orgId, name: 'Client ' + suffix, type: 'Client' }).select('id').single();
    if (company.error) throw new Error('AC-EBR-011 fixture client: ' + company.error.message);
    companyId = company.data.id;
    const project = await admin.from('projects').insert({
      org_id: orgId, project_manager_id: pm.data.id, name: 'Discipline project ' + suffix, status: 'Ongoing Project', currency: 'EUR', client_id: companyId,
      contract_value: 1_000_000, tax_treatment: 'exclusive', tax_amount: 0, subject_to_vat: false, tax_rate: null,
      tax_base_numerator: 1, tax_base_denominator: 1,
    }).select('id').single();
    if (project.error) throw new Error('AC-EBR-011 fixture project: ' + project.error.message);
    projectId = project.data.id;
    const other = await admin.from('projects').insert({ org_id: orgId, name: 'Second project '+suffix, status: 'Ongoing Project', currency: 'EUR', contract_value: 10000, tax_treatment: 'exclusive', tax_amount: 0 }).select('id').single();
    if (other.error) throw other.error;
    otherProjectId=other.data.id;
    otherWorkOrderId=crypto.randomUUID();
    const otherOrder=await admin.from('work_orders').insert({ id:otherWorkOrderId,org_id:orgId,project_id:otherProjectId,title:'Second order',status:'Issued',wo_number:'WO-second-'+suffix,issued_at:new Date().toISOString(),order_value:10000,tax_treatment:'exclusive',tax_amount:0,currency:'EUR' });
    if(otherOrder.error) throw otherOrder.error;
    const otherPlan=await admin.from('work_order_plan_lines').insert({org_id:orgId,project_id:otherProjectId,work_order_id:otherWorkOrderId,kind:'direct_budget',value:9876.54});
    if(otherPlan.error) throw otherPlan.error;

    workOrderId = crypto.randomUUID();
    const wo = await admin.from('work_orders').insert({
      id: workOrderId, org_id: orgId, project_id: projectId, title: 'Discipline WO ' + suffix, client_po_number: 'PO-' + suffix, status: 'Issued',
      wo_number: 'WO-' + suffix, issued_at: new Date().toISOString(), order_value: 500_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'EUR',
    });
    if (wo.error) throw new Error('AC-EBR-011 fixture work order: ' + wo.error.message);
    const ownPlan = await admin.from('work_order_plan_lines').insert({org_id:orgId,project_id:projectId,work_order_id:workOrderId,kind:'direct_budget',value:1234.56});
    if(ownPlan.error) throw ownPlan.error;
    const discipline = await admin.from('cost_disciplines').insert({ org_id: orgId, code: suffix.slice(0, 20), name: 'Discipline ' + suffix }).select('id').single();
    if (discipline.error) throw new Error('AC-EBR-011 fixture discipline: ' + discipline.error.message);
    disciplineId = discipline.data.id;
    const boq = await admin.from('boq_items').insert({
      org_id: orgId, project_id: projectId, item_code: 'L-' + suffix, description: 'Tagged line', unit: 'm', quantity: 100, rate: 10, discipline_id: disciplineId,
    }).select('id').single();
    if (boq.error) throw new Error('AC-EBR-011 fixture contract line: ' + boq.error.message);
    boqId = boq.data.id;
    const line = await admin.from('work_order_lines').insert({ org_id: orgId, work_order_id: workOrderId, boq_item_id: boqId, quantity: 100 }).select('id').single();
    if (line.error) throw new Error('AC-EBR-011 fixture work-order line: ' + line.error.message);
    const report = await admin.from('daily_site_reports').insert({
      org_id: orgId, project_id: projectId, work_order_id: workOrderId, work_date: '2026-03-01', status: 'validated',
      author_id: author.data.id, validated_by: finance.data.id, validated_at: new Date().toISOString(),
    }).select('id').single();
    if (report.error) throw new Error('AC-EBR-011 fixture report: ' + report.error.message);
    reportId = report.data.id;
    const progress = await admin.from('dsr_progress_lines').insert({
      org_id: orgId, report_id: reportId, position: 1, work_order_line_id: line.data.id, quantity: 12.5, unit: 'm',
      frozen_rate: 10, frozen_rate_source: 'contract', frozen_amount: 125, frozen_at: new Date().toISOString(),
    });
    if (progress.error) throw new Error('AC-EBR-011 fixture progress: ' + progress.error.message);

    const invoice = await admin.from('sales_invoices').insert({
      org_id: orgId, project_id: projectId, work_order_id: workOrderId, customer_id: companyId, si_number: 'SI-' + suffix, invoice_date: '2026-03-05',
      amount: 50, currency: 'EUR', tax_treatment: 'exclusive', tax_amount: 0, status: 'Unpaid',
    }).select('id').single();
    if (invoice.error) throw new Error('AC-EBR-011 fixture invoice: ' + invoice.error.message);
    invoiceId = invoice.data.id;

    await pinEnglishLocale(page);
    await signIn(page, 'pm@acme.test');
    await page.route('**/api/resource/**', (route) => route.abort());
    await page.goto('/projects/' + projectId + '/orders');
    const panel = page.getByTestId('earned-billed');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    const fmt = (v: string) => formatExactMoney(v, 'EUR', 'en-US') ?? 'unformattable';
    const key = 'earned-billed-row-' + workOrderId;
    await expect(panel.getByTestId(key + '-earned')).toHaveText(fmt('125.00'));
    await expect(panel.getByTestId(key + '-billed')).toHaveText(fmt('50.00'));
    await expect(panel.getByTestId(key + '-gap')).toHaveText(fmt('75.00'));
    await expect(panel.getByTestId('earned-billed-EUR').getByTestId('earned-billed-row-total-gap')).toHaveText(fmt('75.00'));


    await expect(page.getByTestId('wo-pva-row-'+workOrderId)).toContainText(formatTableMoney('1234.56','EUR') ?? 'unformattable');
    await page.goto('/projects/'+otherProjectId+'/orders');
    await expect(page.getByRole('link', {name: /Second order/})).toBeVisible({timeout:15000});
    await expect(page.getByText('The revenue plan is restricted for your role.')).toBeVisible();
    await expect(page.getByTestId('wo-plan-vs-actual')).toHaveCount(0);
    await expect(page.getByText(formatTableMoney('9876.54','EUR') ?? 'unformattable', {exact:true})).toHaveCount(0);
    await expect(page.getByTestId('wo-pva-row-'+otherWorkOrderId)).toHaveCount(0);

  } catch (e) {
    failure = e;
  } finally {
    if(otherWorkOrderId) {
      await cleanup('second plan',()=>admin.from('work_order_plan_lines').delete().eq('work_order_id',otherWorkOrderId));
      await cleanup('second order',()=>admin.from('work_orders').delete().eq('id',otherWorkOrderId));
    }
    if(otherProjectId) await cleanup('second project',()=>admin.from('projects').delete().eq('id',otherProjectId));
    if(workOrderId) await cleanup('own plan',()=>admin.from('work_order_plan_lines').delete().eq('work_order_id',workOrderId));
    if (invoiceId) await cleanup('delete invoice', () => admin.from('sales_invoices').delete().eq('id', invoiceId));
    if (reportId) await cleanup('delete report', () => admin.from('daily_site_reports').delete().eq('id', reportId));
    if (workOrderId) await cleanup('delete work-order lines', () => admin.from('work_order_lines').delete().eq('work_order_id', workOrderId));
    if (boqId) await cleanup('delete contract line', () => admin.from('boq_items').delete().eq('id', boqId));
    if (workOrderId) await cleanup('delete work order', () => admin.from('work_orders').delete().eq('id', workOrderId));
    if (disciplineId) await cleanup('delete discipline', () => admin.from('cost_disciplines').delete().eq('id', disciplineId));
    if (projectId) await cleanup('delete project', () => admin.from('projects').delete().eq('id', projectId));
    if (companyId) await cleanup('delete client', () => admin.from('companies').delete().eq('id', companyId));
    if (orgId) await cleanup('restore setting', () => admin.from('organizations').update({ discipline_profit_enabled: previousSetting }).eq('id', orgId));
  }
  if (cleanupFailures.length > 0) {
    const ce = new Error('AC-EBR-011 cleanup failed: ' + cleanupFailures.join('; '));
    if (failure) throw new AggregateError([failure, ce], 'AC-EBR-011 failed and cleanup reported errors');
    throw ce;
  }
  if (failure) throw failure;
});
