// @e2e-isolation: self-isolated — creates a unique local client, project, issued work order, its billing step rows and an approved document; deletes only rows linked to this run in finally. It writes the step rows directly (never the organisation's default template), so no other spec's work orders gain a list.
// AC-WBS-012 — a work order with a billing step list: Finance sees the whole chain on the record page, attaches the required
// document to the first step and finishes it; the next step opens; the billing board shows the same rows. Goal oracle: the chain
// advances in order and the work order's list is where the person looked, without any chasing.
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireServiceRoleKey, signIn } from './helpers';
import { orgToday } from './support/jobJourney';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';
import { openWorkOrderArea } from './support/workOrderArea';

test.setTimeout(120_000);

test('AC-WBS-012 a work order\'s billing steps advance in order and appear on the board', async ({ page }) => {
  const serviceKey = requireServiceRoleKey();
  if (!serviceKey) throw new Error('AC-WBS-012 requires the local fixture service client');
  const admin: SupabaseClient = createClient(requireMatchingLocalSupabaseUrls(undefined, undefined), serviceKey, { auth: { persistSession: false } });
  const suffix = 'WBS-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  let companyId = '';
  let projectId = '';
  let workOrderId = '';
  let documentId = '';
  let failure: unknown;
  const cleanupFailures: string[] = [];
  const cleanup = async (label: string, op: () => PromiseLike<{ error: { message: string } | null }>) => {
    try { const r = await op(); if (r.error) cleanupFailures.push(label + ': ' + r.error.message); }
    catch (e) { cleanupFailures.push(label + ': ' + (e instanceof Error ? e.message : String(e))); }
  };

  try {
    const profile = await admin.from('profiles').select('id,org_id').eq('email', 'finance@acme.test').single();
    if (profile.error) throw new Error('AC-WBS-012 fixture profile: ' + profile.error.message);
    const orgId = profile.data.org_id;
    const company = await admin.from('companies').insert({ org_id: orgId, name: 'Client ' + suffix, type: 'Client' }).select('id').single();
    if (company.error) throw new Error('AC-WBS-012 fixture client: ' + company.error.message);
    companyId = company.data.id;
    const project = await admin.from('projects').insert({
      org_id: orgId, name: 'Steps project ' + suffix, status: 'Ongoing Project', currency: 'EUR', client_id: companyId,
      contract_value: 1_000_000, tax_treatment: 'exclusive', tax_amount: 0, subject_to_vat: false, tax_rate: null,
      tax_base_numerator: 1, tax_base_denominator: 1,
    }).select('id').single();
    if (project.error) throw new Error('AC-WBS-012 fixture project: ' + project.error.message);
    projectId = project.data.id;
    workOrderId = crypto.randomUUID();
    const wo = await admin.from('work_orders').insert({
      id: workOrderId, org_id: orgId, project_id: projectId, title: 'Steps journey ' + suffix, status: 'Issued', wo_number: 'WO-' + suffix,
      issued_at: new Date().toISOString(), order_value: 500_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'EUR',
    });
    if (wo.error) throw new Error('AC-WBS-012 fixture work order: ' + wo.error.message);
    const today = orgToday();
    const steps = await admin.from('work_order_billing_steps').insert([
      { org_id: orgId, work_order_id: workOrderId, project_id: projectId, position: 1, name: 'First ' + suffix, owner_role_key: 'billing_officer', target_days: 5, started_on: today },
      { org_id: orgId, work_order_id: workOrderId, project_id: projectId, position: 2, name: 'Second ' + suffix, owner_role_key: 'finance_officer' },
    ]).select('id,position');
    if (steps.error) throw new Error('AC-WBS-012 fixture steps: ' + steps.error.message);
    const first = steps.data.find((s) => s.position === 1)?.id;
    const slot = await admin.from('work_order_billing_step_documents').insert({ org_id: orgId, step_id: first, work_order_id: workOrderId, position: 1, name: 'Evidence slot ' + suffix, required: true });
    if (slot.error) throw new Error('AC-WBS-012 fixture slot: ' + slot.error.message);
    documentId = crypto.randomUUID();
    const doc = await admin.from('project_documents').insert({
      id: documentId, org_id: orgId, project_id: projectId, category: 'Acceptance', title: 'Evidence ' + suffix, status: 'Approved',
      author_id: profile.data.id, file_path: orgId + '/' + projectId + '/' + documentId + '/evidence.pdf',
    });
    if (doc.error) throw new Error('AC-WBS-012 fixture document: ' + doc.error.message);

    await signIn(page, 'finance@acme.test');
    await page.route('**/api/resource/**', (route) => route.abort());

    // The record shows the chain; the first step is current and cannot be finished without its required document.
    await page.goto('/work-orders/' + workOrderId);
    await openWorkOrderArea(page, 'billing');
    await expect(page.getByTestId('wo-billing-steps-summary')).toContainText('2 steps not finished');
    await expect(page.getByRole('button', { name: 'Mark First ' + suffix + ' done' })).toBeDisabled();
    await page.getByRole('combobox', { name: 'Document for Evidence slot ' + suffix }).selectOption({ label: 'Evidence ' + suffix });
    await page.getByRole('button', { name: 'Attach to Evidence slot ' + suffix }).click();
    await page.getByRole('button', { name: 'Mark First ' + suffix + ' done' }).click();
    await expect(page.getByTestId('wo-billing-steps-summary')).toContainText('1 step not finished');

    // The next step is now current for its owner; the board lists the same rows.
    await expect(page.getByRole('button', { name: 'Mark Second ' + suffix + ' done' })).toBeEnabled();
    await page.goto('/finance/billing-board?project=' + projectId);
    await expect(page.getByTestId('billing-board-wo-steps')).toContainText('Second ' + suffix);
  } catch (e) {
    failure = e;
  } finally {
    if (workOrderId) await cleanup('delete work order', () => admin.from('work_orders').delete().eq('id', workOrderId));
    if (documentId) await cleanup('delete document', () => admin.from('project_documents').delete().eq('id', documentId));
    if (projectId) await cleanup('delete project', () => admin.from('projects').delete().eq('id', projectId));
    if (companyId) await cleanup('delete client', () => admin.from('companies').delete().eq('id', companyId));
  }
  if (cleanupFailures.length > 0) {
    const ce = new Error('AC-WBS-012 cleanup failed: ' + cleanupFailures.join('; '));
    if (failure) throw new AggregateError([failure, ce], 'AC-WBS-012 failed and cleanup reported errors');
    throw ce;
  }
  if (failure) throw failure;
});
